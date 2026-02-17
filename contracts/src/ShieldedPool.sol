// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./IVerifier.sol";
import "./IPoseidon.sol";

/**
 * @title ShieldedPool
 * @notice 隐私 ERC20 屏蔽池合约
 * @dev 实现类似 Tornado Cash 的隐私转账机制
 *
 * 核心机制:
 * 1. 用户存入代币时，提交一个 Commitment (承诺值)
 * 2. Commitment 被添加到 Merkle 树中
 * 3. 用户可以通过提交 ZK 证明来花费 Notes，同时创建新的 Commitments
 * 4. Nullifier 用于防止双花 (由 Poseidon(secret, leaf_index) 生成)
 */
contract ShieldedPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ 状态变量 ============

    /// @notice 底层 ERC20 代币
    IERC20 public immutable token;

    /// @notice Merkle 树的高度
    uint256 public constant TREE_HEIGHT = 20;

    /// @notice 最大叶子数量 (2^20)
    uint256 public constant MAX_LEAVES = 1 << TREE_HEIGHT;

    /// @notice 当前叶子索引
    uint256 public nextLeafIndex;

    /// @notice 历史 Merkle Roots (用于验证)
    mapping(bytes32 => bool) public roots;

    /// @notice 已使用的 Nullifiers (防止双花)
    mapping(bytes32 => bool) public nullifiers;

    /// @notice Merkle 树的叶子节点
    mapping(uint256 => bytes32) public leaves;

    /// @notice 零值数组 (预计算)
    bytes32[TREE_HEIGHT + 1] public zeros;

    /// @notice 每层填充的节点 (用于增量更新)
    bytes32[TREE_HEIGHT] public filledSubtrees;

    /// @notice ZK 验证器合约
    address public verifier;

    /// @notice Poseidon 哈希合约 (2个输入)
    address public poseidon2;

    // ============ 事件 ============

    /// @notice 存款事件
    event Deposit(
        bytes32 indexed commitment,
        uint256 leafIndex,
        uint256 timestamp
    );

    /// @notice 交易事件 (包含提款)
    event Transact(
        bytes32 indexed nullifier1,
        bytes32 indexed nullifier2,
        bytes32 commitment1,
        bytes32 commitment2
    );

    /// @notice 提款事件
    event Withdrawal(address indexed recipient, uint256 amount);

    // ============ 构造函数 ============

    /**
     * @param _token 底层 ERC20 代币地址
     * @param _verifier ZK 验证器合约地址
     */
    constructor(address _token, address _verifier, address _poseidon2) {
        token = IERC20(_token);
        verifier = _verifier;
        poseidon2 = _poseidon2;

        // 初始化零值数组
        zeros[0] = bytes32(0);
        for (uint256 i = 1; i <= TREE_HEIGHT; i++) {
            zeros[i] = _hashPair(zeros[i - 1], zeros[i - 1]);
        }

        // 初始化填充子树
        for (uint256 i = 0; i < TREE_HEIGHT; i++) {
            filledSubtrees[i] = zeros[i];
        }

        // 记录初始根
        roots[_computeRoot()] = true;
    }

    // ============ 外部函数 ============

    /**
     * @notice 存款: 将代币存入屏蔽池
     * @param commitment 用户计算的 Commitment (Poseidon(amount, secret, blinding))
     * @param amount 存款金额
     */
    function deposit(bytes32 commitment, uint256 amount) external nonReentrant {
        require(nextLeafIndex < MAX_LEAVES, "Tree is full");
        require(commitment != bytes32(0), "Invalid commitment");
        require(amount > 0, "Amount must be positive");

        // 转入代币
        token.safeTransferFrom(msg.sender, address(this), amount);

        // 插入叶子到 Merkle 树
        _insert(commitment);

        emit Deposit(commitment, nextLeafIndex - 1, block.timestamp);
    }

    /**
     * @notice 交易: 花费旧 Notes，创建新 Notes
     * @param proof ZK 证明 (ABI 编码)
     * @param root 引用的 Merkle Root
     * @param nullifier1 第一个输入的 Nullifier
     * @param nullifier2 第二个输入的 Nullifier
     * @param commitment1 第一个输出 Commitment
     * @param commitment2 第二个输出 Commitment
     * @param publicAmount 公开金额 (正=存入, 负=提取)
     * @param recipient 提款接收地址 (如果 publicAmount < 0)
     */
    function transact(
        bytes calldata proof,
        bytes32 root,
        bytes32 nullifier1,
        bytes32 nullifier2,
        bytes32 commitment1,
        bytes32 commitment2,
        int256 publicAmount,
        address recipient
    ) external nonReentrant {
        // 验证 Root 有效
        require(roots[root], "Invalid root");

        // 验证 Nullifiers 未被使用
        require(!nullifiers[nullifier1], "Nullifier1 already spent");
        require(!nullifiers[nullifier2], "Nullifier2 already spent");

        // 验证 ZK 证明
        require(
            _verifyProof(
                proof,
                root,
                nullifier1,
                nullifier2,
                commitment1,
                commitment2,
                publicAmount
            ),
            "Invalid proof"
        );

        // 标记 Nullifiers 为已使用
        nullifiers[nullifier1] = true;
        nullifiers[nullifier2] = true;

        // 插入新的 Commitments
        if (commitment1 != bytes32(0)) {
            _insert(commitment1);
        }
        if (commitment2 != bytes32(0)) {
            _insert(commitment2);
        }

        // 处理公开金额
        if (publicAmount > 0) {
            // 额外存入
            token.safeTransferFrom(msg.sender, address(this), uint256(publicAmount));
        } else if (publicAmount < 0) {
            // 提款
            require(recipient != address(0), "Invalid recipient");
            uint256 withdrawAmount = uint256(-publicAmount);
            token.safeTransfer(recipient, withdrawAmount);
            emit Withdrawal(recipient, withdrawAmount);
        }

        emit Transact(nullifier1, nullifier2, commitment1, commitment2);
    }

    /**
     * @notice 获取当前 Merkle Root
     */
    function getRoot() external view returns (bytes32) {
        return _computeRoot();
    }

    /**
     * @notice 检查 Nullifier 是否已使用
     */
    function isSpent(bytes32 nullifier) external view returns (bool) {
        return nullifiers[nullifier];
    }

    // ============ 内部函数 ============

    /**
     * @dev 插入叶子到 Merkle 树
     */
    function _insert(bytes32 leaf) internal {
        uint256 currentIndex = nextLeafIndex;
        bytes32 currentHash = leaf;

        for (uint256 i = 0; i < TREE_HEIGHT; i++) {
            if (currentIndex % 2 == 0) {
                // 左节点
                filledSubtrees[i] = currentHash;
                currentHash = _hashPair(currentHash, zeros[i]);
            } else {
                // 右节点
                currentHash = _hashPair(filledSubtrees[i], currentHash);
            }
            currentIndex /= 2;
        }

        leaves[nextLeafIndex] = leaf;
        nextLeafIndex++;

        // 记录新的根
        roots[_computeRoot()] = true;
    }

    /**
     * @dev 计算当前 Merkle Root
     */
    function _computeRoot() internal view returns (bytes32) {
        bytes32 currentHash = zeros[0];
        uint256 currentIndex = nextLeafIndex;

        for (uint256 i = 0; i < TREE_HEIGHT; i++) {
            if (currentIndex % 2 == 0) {
                currentHash = _hashPair(filledSubtrees[i], zeros[i]);
            } else {
                currentHash = _hashPair(filledSubtrees[i], currentHash);
            }
            currentIndex /= 2;
        }

        return currentHash;
    }

    /**
     * @dev 哈希两个节点 (使用 Poseidon 替代 keccak256 以对齐 ZK 电路)
     */
    function _hashPair(bytes32 left, bytes32 right) internal view returns (bytes32) {
        uint256[2] memory inputs;
        inputs[0] = uint256(left);
        inputs[1] = uint256(right);
        return bytes32(IPoseidon(poseidon2).poseidon(inputs));
    }

    /**
     * @dev 验证 ZK 证明
     * @notice TODO: 接入真正的 Groth16 Verifier
     */
    function _verifyProof(
        bytes calldata proof,
        bytes32 root,
        bytes32 nullifier1,
        bytes32 nullifier2,
        bytes32 commitment1,
        bytes32 commitment2,
        int256 publicAmount
    ) internal view returns (bool) {
        if (verifier == address(0)) {
            return true;
        }

        (
            uint256[2] memory a,
            uint256[2][2] memory b,
            uint256[2] memory c
        ) = abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));

        uint256[7] memory publicInputs;
        publicInputs[0] = uint256(root);
        publicInputs[1] = uint256(nullifier1);
        publicInputs[2] = uint256(nullifier2);
        publicInputs[3] = uint256(commitment1);
        publicInputs[4] = uint256(commitment2);
        publicInputs[5] = uint256(uint256(publicAmount));
        publicInputs[6] = 0; // fee

        return IVerifier(verifier).verifyProof(a, b, c, publicInputs);
    }
}
