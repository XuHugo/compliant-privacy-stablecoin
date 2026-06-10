# 隐私稳定币改造与合规升级计划

本项目原设计为通用的隐私 ERC20 协议，为了将其安全、合规地应用于稳定币（USDT/USDC）场景，我们需要对智能合约、零知识电路以及系统架构进行深度改造。

本计划书详细说明了安全修复、用户体验提升以及**第三方合规审查**的改造路径。

---

## 1. 核心安全修复：防 MEV 抢跑 🚨

当前版本中，用户提款时指定的接收地址（`recipient`）未被包含在 ZK Proof 的公共输入中进行签名验证。这导致 MEV 机器人可以拦截交易、替换接收地址并盗走资金。

### 改造方案：
*   **电路层 (Circom)**：将 `recipient` 地址和 `fee`（中继者费用）作为 `public input` 传入电路。在电路内部使用一个 dummy constraint（如 `signal input recipient; recipient * recipient === recipient * recipient;` 或者计算它们的哈希并约束）来确保这些变量被绑定到生成的 Proof 中。
*   **合约层 (Solidity)**：在 `_verifyProof` 中，将 `recipient` 和 `fee` 正确赋值到 `publicInputs` 数组中。

---

## 2. 稳定币原生体验增强 ⚡

为了让稳定币的隐私支付真正可用，必须消除用户对 ETH (Gas 费) 的直接依赖。

### 2.1 引入中继器机制 (Relayer Gas Abstraction)
用户在提取或匿名转账稳定币时，新钱包中通常没有 ETH 付 Gas。
*   **改造**：在 `transact` 参数和 ZK 证明中正式启用 `fee` 和 `relayer` 地址。
*   **流程**：用户在本地生成包含 `fee`（比如 1 USDC）的 Proof，发送给 Relayer。Relayer 代付 ETH 上链，合约验证成功后，将 `fee` 转移给 Relayer 的地址，剩余资金发给 `recipient`。

### 2.2 支持 EIP-2612 Permit 无 Gas 存款
当前存款需要两步：先 `Approve` 授权，再 `Deposit`，消耗双倍 Gas 且体验差。USDC 原生支持离线签名授权。
*   **改造**：在 `ShieldedPool.sol` 中新增 `depositWithPermit` 方法，接收 `v, r, s, deadline` 参数，在合约内先调用 `token.permit(...)`，然后直接执行 `deposit`。

---

##   🏦

为了防止稳定币发行方（如 Tether、Circle）因洗钱风险将屏蔽池合约拉入黑名单，系统必须提供可靠的合规审查能力。考虑到不同监管环境和用户的去中心化诉求，我们将系统设计为**支持双轨制合规（可同时运行或二选一）**：

### 轨道 A：去中心化合规 —— 无辜证明 (Proof of Innocence, POI)
完全符合 Crypto 精神的极客方案，通过数学自证清白，无需任何人审批即可自由存款。
*   **机制**：存款绝对自由（无任何拦截）。但在**提款**时，除了原有的 ZK Proof，用户必须额外提供一个“关联集证明 (Association Set Proof)”。
*   **流程**：
    1. 链下的安全机构或 DAO 维护一棵排除了已知黑客资金的“干净存款 Merkle 树（Allowlist）”。
    2. 用户生成提款 Proof 时，需要在电路中同时验证：我的资金在总池子中，**并且**我也在“干净存款树”中。
    3. 智能合约验证提款时，会核对用户提供的 `cleanTreeRoot` 是否属于受认可的安全机构。
*   **特点**：极度抗审查，普通用户完全隐匿在“干净群体”中，黑客即使存了钱也无法生成合法的提款 Proof。

### 轨道 B：中心化合规 —— 第三方节点前置审查与签名 (KYC/AML)
面向企业级和强监管环境的务实方案，在资金进入池子前就掐断黑钱。
*   **机制**：设立受信任的**合规服务商 (Compliance Oracle)**。
*   **流程**：
    1. 前端在发起存款前，调用合规 API（如 Chainalysis）审查用户的钱包地址。
    2. 审查通过后，合规节点用私钥对用户的 `commitment` 签名。
    3. 智能合约的 `deposit` 方法强制校验该签名。
*   **特点**：实现简单，深受传统监管机构认可，但存在中心化单点故障和强审查风险。

### 进阶审计与追溯机制 (Advanced Audit & Traceability)
无论采用轨道 A 还是 B，为应对极端犯罪事件（如反恐融资调查），系统需要提供事后审计能力。我们拒绝使用自带“上帝视角”的单一后门，而是提供以下两种更去中心化的审计选项：

#### 选项一：被动合规 —— 用户自主出示凭证 (Viewing Keys / Opt-in Disclosure)
最保护人权的方案，系统无后门，赋予用户自证清白的能力。
*   **机制**：用户的客户端不仅拥有交易私钥，还拥有“查看密钥 (Viewing Key)”。
*   **流程**：当遭遇执法机构调查时，嫌疑人可以自愿（或在法庭命令下）交出某笔交易的查看密钥，或者生成一个针对该笔交易的 ZK Receipt（零知识收据）。
*   **特点**：执法机构只能解密该特定用户主动提供的账单，全网其他人的隐私依然绝对安全。符合“无罪推定”原则。

#### 选项二：主动合规 —— 门限加密与混合加密架构 (Hybrid Threshold Encryption)
兼顾全网追踪与反极权的终极方案，采用“链下门限非对称加密 + 链上 ZK 对称加密防伪”的**混合加密双向承诺机制**，解决 Circom 电路内非对称加密性能极其低下的问题。
*   **机制**：
    1. 在链下配置一个“全局审计公钥”（如 RSA-2048），私钥被碎成多片（3-of-5）交由不同实体保管（DKG 门限加密）。
    2. 电路内置极度轻量级的 `Poseidon 对称加密` 原语。
*   **流程**：
    1. 用户 `transact` 前，在前端生成一个**一次性随机对称密钥 $K_{sym}$**。
    2. **链下操作**：用户使用全局审计公钥对 $K_{sym}$ 进行非对称加密，生成密文一 $C_1$。
    3. **链上 ZK 操作**：用户将真实的交易细节 $M$ 和 $K_{sym}$ 传入 ZK 电路。电路强制使用 $K_{sym}$ 对 $M$ 进行 Poseidon 对称加密，生成密文二 $C_2$。$C_2$ 必须作为 Public Input 暴露，以在数学上保证其与真实的 $M$ 强绑定。
    4. 智能合约将 $C_1$ 和 $C_2$ 一并存储上链。
    5. 执法机构查账时，先获取 3/5 授权解开 $C_1$ 得到 $K_{sym}$，再用 $K_{sym}$ 解开 $C_2$ 获得转账明文 $M$。
*   **特点**：警察拥有了追查黑钱的“物理能力”，但被权力制衡机制约束；同时极大节省了生成 ZK Proof 的计算时间。

---

## 4. 智能合约接口变更对比

### 旧版接口：
```solidity
function deposit(bytes32 commitment, uint256 amount) external;
function transact(bytes calldata proof, bytes32 root, bytes32 nullifier1, bytes32 nullifier2, bytes32 commitment1, bytes32 commitment2, int256 publicAmount, address recipient) external;
```

### 改造后接口：
```solidity
// ==========================================
// 轨道 B 相关状态：合规服务商地址管理
address public complianceSigner;

// 轨道 A 相关状态：受信任的干净树根列表 (由 Oracle 更新)
mapping(bytes32 => bool) public approvedCleanRoots;
// ==========================================

// 存款 (支持 Permit，并可选要求合规签名)
function depositWithPermitAndCompliance(
    bytes32 commitment, 
    uint256 amount,
    uint256 deadline, uint8 v, bytes32 r, bytes32 s, // EIP-2612
    bytes calldata complianceSignature               // (轨道 B 验证此签名；轨道 A 可留空)
) external;

// 交易 (包含防抢跑、Relayer抽成，以及 POI 和审计密文)
function transact(
    bytes calldata proof, 
    bytes32 root, 
    bytes32 cleanTreeRoot, // 轨道 A: 干净树的根 (POI)
    bytes32 nullifier1, bytes32 nullifier2, 
    bytes32 commitment1, bytes32 commitment2, 
    int256 publicAmount, 
    address recipient,
    address relayer,     // 中继器地址 (在电路中验证)
    uint256 relayerFee,  // 中继器费用 (在电路中验证)
    bytes calldata encryptedAuditData // 审计密文
) external;
```

---

## 5. 实施步骤

1.  **Phase 1：安全与体验修复** (修改 Circom 电路加入 recipient/relayer 约束，修改 Solidity 引入 Relayer 和 Permit)。
2.  **Phase 2：双轨合规架构落地**
    *   **轨道 B 实现**：引入 ECDSA 签名验证，实现 `complianceSigner` 授权存款。
    *   **轨道 A 实现**：重构 Circom 电路，加入双重 Merkle Proof 验证（POI 逻辑），合约加入 `cleanTreeRoot` 校验。
3.  **Phase 3：进阶审计追踪落地** 
    *   **架构敲定**：采用“链下非对称加密 (DKG) + 链内 Poseidon 对称加密”的双向承诺方案。
    *   **电路实现**：在 `joinsplit.circom` 中增加流密码模式的 Poseidon 运算，强制输出 `auditCiphertext`。
    *   **合约实现**：将 `encryptedAuditData` 等通过 `Transact` 事件永久记录在链上。
