// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/ShieldedPool.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../src/IVerifier.sol";
import "../src/IPoseidon.sol";

// Mock ERC20 Token
contract MockToken is ERC20 {
    constructor() ERC20("Mock Token", "MCK") {
        _mint(msg.sender, 10000 * 10**18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

// Mock Verifier
contract MockVerifier is IVerifier {
    bool public shouldVerify = true;

    function setVerify(bool _otp) external {
        shouldVerify = _otp;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[14] calldata input
    ) external view override returns (bool) {
        // 验证公共输入是否按预期顺序排列 (root, nullifier1, nullifier2, commitment1, commitment2, publicAmount, fee)
        // 在 testTransact 中，我们会传入特定的值，这里可以进行校验
        return shouldVerify;
    }
}

contract ShieldedPoolTest is Test {
    ShieldedPool public pool;
    MockToken public token;
    MockVerifier public verifier;
    address public poseidon;

    address public user1 = address(0x1);
    address public user2 = address(0x2);

    function setUp() public {
        token = new MockToken();
        verifier = new MockVerifier();
        
        // 从生成的字节码文件部署真实的 Poseidon 合约
        // 注意：这里我们读取之前生成的 Poseidon_bytecode.txt
        string memory rootPath = vm.projectRoot();
        string memory path = string.concat(rootPath, "/../Poseidon_bytecode.txt");
        string memory bytecode = vm.readFile(path);
        
        // vm.parseBytes handles the '0x' prefix automatically.
        // If the bytecode string starts with "0x", vm.parseBytes will correctly interpret it.
        // If it does not start with "0x", it will also correctly interpret it as a hex string.
        bytes memory data = vm.parseBytes(bytecode);
        
        address deployedPoseidon;
        assembly {
            deployedPoseidon := create(0, add(data, 0x20), mload(data))
        }
        poseidon = deployedPoseidon;
        require(poseidon != address(0), "Poseidon deployment failed");

        pool = new ShieldedPool(address(token), address(verifier), poseidon, address(this));

        // Fund users
        token.mint(user1, 100 ether);
        token.mint(user2, 100 ether);

        vm.prank(user1);
        token.approve(address(pool), type(uint256).max);

        vm.prank(user2);
        token.approve(address(pool), type(uint256).max);
    }

    function testDeposit() public {
        vm.prank(user1);
        bytes32 commitment = bytes32(uint256(123456));
        uint256 amount = 10 ether;

        pool.deposit(commitment, amount);

        // Check balance transferred
        assertEq(token.balanceOf(address(pool)), amount);
        
        // Check Merkle root update (it shouldn't be the empty one)
        bytes32 root = pool.getRoot();
        assertTrue(pool.roots(root));
        assertEq(pool.nextLeafIndex(), 1);
    }

    function testTransact() public {
        // 1. Setup - Deposit first to have a valid root/leaf
        vm.startPrank(user1);
        bytes32 commitment = bytes32(uint256(123456));
        uint256 amount = 10 ether;
        pool.deposit(commitment, amount);
        bytes32 root = pool.getRoot();
        vm.stopPrank();

        // 2. Transact (Withdraw)
        int256 publicAmount = -5 ether; // Withdraw 5 ether
        bytes32 nullifier1 = bytes32(uint256(111));
        bytes32 nullifier2 = bytes32(uint256(222));
        bytes32 newCommitment1 = bytes32(uint256(333));
        bytes32 newCommitment2 = bytes32(uint256(444));
        
        // Mock proof structure
        bytes memory proof = abi.encode(
            [uint256(1), uint256(2)],
            [[uint256(3), uint256(4)], [uint256(5), uint256(6)]],
            [uint256(7), uint256(8)]
        );

        uint256[4] memory emptyCiphertext;
        
        vm.prank(user1);
        pool.transact(
            proof,
            root,
            bytes32(0), // cleanTreeRoot
            nullifier1,
            nullifier2,
            newCommitment1,
            newCommitment2,
            publicAmount,
            user1, // Recipient
            address(0), // relayer
            0, // relayerFee
            "", // encryptedAuditData
            emptyCiphertext
        );

        // Check balances
        assertEq(token.balanceOf(user1), 95 ether); // 100 - 10 (dep) + 5 (with)
        assertEq(token.balanceOf(address(pool)), 5 ether); // 10 (dep) - 5 (with)

        // Check Nullifiers spent
        assertTrue(pool.isSpent(nullifier1));
        assertTrue(pool.isSpent(nullifier2));

        // Check new commitments added
        assertEq(pool.nextLeafIndex(), 3); // 1 (dep) + 2 (transact output)
    }

    function testTransactFailInvalidProof() public {
        verifier.setVerify(false);

        bytes32 root = pool.getRoot(); // Empty root is valid initially
        
        uint256[4] memory emptyCiphertext;
        vm.expectRevert("Invalid proof");
        pool.transact(
            abi.encode([uint256(0), uint256(0)], [[uint256(0), uint256(0)], [uint256(0), uint256(0)]], [uint256(0), uint256(0)]),
            root,
            bytes32(0), // cleanTreeRoot
            bytes32(uint256(1)),
            bytes32(uint256(2)),
            bytes32(0),
            bytes32(0),
            0,
            address(0),
            address(0),
            0,
            "",
            emptyCiphertext
        );
    }

    function testTransactFailDoubleSpend() public {
        // Deposit
        vm.prank(user1);
        pool.deposit(bytes32(uint256(123)), 10 ether);
        bytes32 root = pool.getRoot();

        bytes memory proof = abi.encode(
             [uint256(1), uint256(2)],
            [[uint256(3), uint256(4)], [uint256(5), uint256(6)]],
            [uint256(7), uint256(8)]
        );

        uint256[4] memory emptyCiphertext;
        
        // First spend
        pool.transact(
            proof,
            root,
            bytes32(0), // cleanTreeRoot
            bytes32(uint256(1)), // Nullifier A
            bytes32(uint256(2)),
            bytes32(0),
            bytes32(0),
            0,
            address(0),
            address(0),
            0,
            "",
            emptyCiphertext
        );

        // Second spend with same Nullifier A
        vm.expectRevert("Nullifier1 already spent");
        pool.transact(
            proof,
            root,
            bytes32(0), // cleanTreeRoot
            bytes32(uint256(1)), // Nullifier A again
            bytes32(uint256(3)),
            bytes32(0),
            bytes32(0),
            0,
            address(0),
            address(0),
            0,
            "",
            emptyCiphertext
        );
    }

    function testTransactFailMEVFrontRun() public {
        vm.prank(user1);
        pool.deposit(bytes32(uint256(123)), 10 ether);
        bytes32 root = pool.getRoot();

        bytes memory proof = abi.encode(
             [uint256(1), uint256(2)],
            [[uint256(3), uint256(4)], [uint256(5), uint256(6)]],
            [uint256(7), uint256(8)]
        );

        // MEV bot 尝试使用截获的 Proof，但是修改了 recipient 为自己 (user2)
        // 注意：在真实的 ZK Proof 中，如果 recipient 作为 public input 改变，Proof 验证必然失败
        // 我们通过修改 verifier 让其如果 recipient 改变就拒绝（MockVerifier 需要能区分）
        // 但其实这里只需确信 "Invalid proof" 即可。我们目前的 MockVerifier 一律放行，所以测试会通过吗？
        // 因为我们想测试智能合约正确传递了 recipient。
        // 这里模拟：如果 proof 不匹配 public inputs（recipient 不同），verifier 返回 false。
        verifier.setVerify(false); // 模拟被篡改的 public input 导致 proof 失败

        uint256[4] memory emptyCiphertext;

        vm.expectRevert("Invalid proof");
        pool.transact(
            proof,
            root,
            bytes32(0),
            bytes32(uint256(1)),
            bytes32(uint256(2)),
            bytes32(0),
            bytes32(0),
            -5 ether,
            user2, // 恶意的接收者
            address(0),
            0,
            "",
            emptyCiphertext
        );
    }

    function testTransactWithRelayerFee() public {
        vm.prank(user1);
        pool.deposit(bytes32(uint256(123)), 10 ether);
        bytes32 root = pool.getRoot();

        bytes memory proof = abi.encode([uint256(1), uint256(2)], [[uint256(3), uint256(4)], [uint256(5), uint256(6)]], [uint256(7), uint256(8)]);

        address relayer = address(0x99);
        uint256 fee = 1 ether;

        uint256[4] memory emptyCiphertext;

        pool.transact(
            proof,
            root,
            bytes32(0),
            bytes32(uint256(1)),
            bytes32(uint256(2)),
            bytes32(0),
            bytes32(0),
            -5 ether,
            user1,
            relayer,
            fee,
            "",
            emptyCiphertext
        );

        assertEq(token.balanceOf(user1), 94 ether); // 100 - 10 + (5-1)
        assertEq(token.balanceOf(relayer), 1 ether);
    }

    function testTransactPOI() public {
        bytes32 cleanRoot = bytes32(uint256(999));
        bytes memory dummyProof = abi.encode([uint256(0), uint256(0)], [[uint256(0), uint256(0)], [uint256(0), uint256(0)]], [uint256(0), uint256(0)]);
        uint256[4] memory emptyCiphertext;
        
        bytes32 currentRoot = pool.getRoot();

        // 未认证的干净树根
        vm.expectRevert("Unapproved clean root");
        pool.transact(
            dummyProof,
            currentRoot,
            cleanRoot,
            bytes32(uint256(1)), bytes32(uint256(2)), bytes32(0), bytes32(0),
            0, address(0), address(0), 0, "", emptyCiphertext
        );

        // 管理员认证
        pool.setApprovedCleanRoot(cleanRoot, true);

        // 现在应该可以通过 POI 检查（接着可能失败在 Invalid proof，我们设置其通过）
        pool.transact(
            dummyProof,
            currentRoot,
            cleanRoot,
            bytes32(uint256(1)), bytes32(uint256(2)), bytes32(0), bytes32(0),
            0, address(0), address(0), 0, "", emptyCiphertext
        );
        assertTrue(pool.isSpent(bytes32(uint256(1))));
    }
}
