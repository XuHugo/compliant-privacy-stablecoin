// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

/**
 * @title AuditRegistry
 * @notice 审计节点名录与 DKG（分布式密钥生成）存证智能合约
 */
contract AuditRegistry {
    // 5个审计节点的以太坊地址列表
    address[5] public auditors;
    mapping(address => bool) public isAuditor;

    // 节点的通信公钥 (用于加密传输 DKG 多项式评估碎片)
    mapping(address => bytes) public communicationPublicKeys;

    // 节点的 DKG 多项式承诺列表 (A_i,0, A_i,1, A_i,2)
    mapping(address => bytes[3]) public dkgCommitments;

    // DKG 节点加密碎片存储: 发送方 -> 接收方 -> 加密后的评估值
    mapping(address => mapping(address => bytes)) public encryptedShares;

    // 聚合完成后的全局审计公钥 (序列化后的 G1 点)
    bytes public globalAuditPublicKey;
    bool public isDkgCompleted;

    address public owner;

    event AuditorRegistered(address indexed auditor, bytes commPublicKey);
    event DkgCommitmentSubmitted(address indexed auditor, bytes[3] commitments);
    event DkgShareSubmitted(address indexed sender, address indexed recipient, bytes encryptedShare);
    event DkgCompleted(bytes globalPublicKey);

    modifier onlyAuditor() {
        require(isAuditor[msg.sender], "Not an authorized auditor");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address[5] memory _auditors) {
        auditors = _auditors;
        for (uint i = 0; i < 5; i++) {
            isAuditor[_auditors[i]] = true;
        }
        owner = msg.sender;
    }

    /**
     * @notice 审计节点注册其加密通信公钥
     * @param pubKey 节点的通信公钥 (通常是 Curve25519 或 ECIES 公钥)
     */
    function registerCommunicationKey(bytes calldata pubKey) external onlyAuditor {
        communicationPublicKeys[msg.sender] = pubKey;
        emit AuditorRegistered(msg.sender, pubKey);
    }

    /**
     * @notice 提交 DKG 多项式承诺以及分发给其他节点的加密多项式碎片
     * @param commitments 多项式的 G1 点承诺列表 (例如: [A_i,0, A_i,1, A_i,2])
     * @param recipients 接收碎片的节点地址列表
     * @param shares 对应的使用接收方公钥加密后的碎片值
     */
    function submitDkgData(
        bytes[3] calldata commitments,
        address[5] calldata recipients,
        bytes[5] calldata shares
    ) external onlyAuditor {
        dkgCommitments[msg.sender] = commitments;
        emit DkgCommitmentSubmitted(msg.sender, commitments);

        for (uint i = 0; i < 5; i++) {
            if (recipients[i] != address(0) && shares[i].length > 0) {
                require(isAuditor[recipients[i]], "Recipient must be an authorized auditor");
                encryptedShares[msg.sender][recipients[i]] = shares[i];
                emit DkgShareSubmitted(msg.sender, recipients[i], shares[i]);
            }
        }
    }

    /**
     * @notice 由 Owner 或节点设置并公示最终生成的全局审计公钥
     * @param globalPubKey 聚合计算后的全局审计公钥 (序列化后的 G1 点)
     */
    function finalizeGlobalPublicKey(bytes calldata globalPubKey) external {
        require(msg.sender == owner || isAuditor[msg.sender], "Unauthorized to finalize public key");
        globalAuditPublicKey = globalPubKey;
        isDkgCompleted = true;
        emit DkgCompleted(globalPubKey);
    }
}
