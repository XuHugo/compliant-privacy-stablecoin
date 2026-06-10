# Compliant Privacy Stablecoin (合规隐私稳定币协议)

基于零知识证明（ZK Proofs）与分布式门限审计（Threshold Cryptography）构建的**可审计、强合规隐私稳定币转账协议**。

## 🌟 核心特性

本项目在提供用户交易隐私的同时，融合了去中心化的链上合规审计监管机制，实现以下三大核心特性：

1. **零知识交易隐私**: 隐藏交易金额、发送者与接收者，利用 Poseidon 密码学哈希构建的 Merkle 树及 ZK 证明防范双花与地址冒用。
2. **分布式门限审计 (3-of-5 Threshold Auditing)**:
   - 采用 **椭圆曲线 ElGamal (Threshold EC-ElGamal)** 与 **分布式密钥生成 (DKG)** 算法。
   - 5 个审计节点各自生成本地私钥碎片与公钥承诺，通过合约聚合最终形成唯一的全局审计公钥。
   - 用户发送交易时，用该全局公钥加密对称审计密钥，并将密文存储在链上交易事件中。
   - 任何单点或两点审计节点都无法解密交易。只有当 3 个或更多受认可的审计节点联合授权时，方可提取链上密文解密还原交易详情。
3. **合规性双轨制 (KYC/POI)**:
   - **轨道 A (去中心化 POI)**: 用户提款时需提交“干净资金树根自证证明”以拦截洗钱。
   - **轨道 B (前置 KYC 签名)**: 合规服务商预审白名单签名，前置掐断黑钱。

---

## 📂 项目结构

```
compliant-privacy-stablecoin/
├── circuits/           # ZK 电路与约束模块 (Circom & Rust)
│   ├── circom/         # .circom 源代码 (Joinsplit 与 Merkle 树)
│   └── src/            # Rust 电路本地约束校验
├── client/             # 链下客户端/钱包/审计工具 (Rust)
│   └── src/
│       ├── audit.rs    # 3-of-5 门限加密、DKG 与解密算法核心
│       ├── wallet.rs   # 隐私 Note 与钱包状态管理
│       └── bin/
│           ├── dkg_gen.rs            # 本地多项式模拟 DKG 与测试 JSON 导出
│           ├── audit_verify.rs       # 链上日志抓取与部分解密验证
│           └── audit_full_verify.rs  # 全流程端到端 (E2E) 门限审计解密工具
├── contracts/          # 智能合约与部署脚本 (Solidity & Foundry)
│   ├── src/
│   │   ├── ShieldedPool.sol  # 隐私代币屏蔽池主合约
│   │   ├── AuditRegistry.sol # 审计节点多签与 DKG 链上公示合约
│   │   └── Verifier.sol      # 编译电路自动生成的 ZK 证明校验器
│   ├── script/
│   │   ├── Deploy.s.sol            # 合约本地一键部署脚本
│   │   ├── TestAuditLive.s.sol     # 链上局部审计交互脚本
│   │   └── TestFullE2EFlow.s.sol   # 全流程 Deposit-Transact-Withdraw 广播脚本
│   └── test/
│       ├── ShieldedPool.t.sol      # 隐私主池单元测试
│       └── AuditRegistry.t.sol     # 链上 DKG 联合校验单元测试
└── README.md
```

---

## 🚀 编译与测试运行指南

### 前提要求
- **Rust nightly** (用于构建密码学及电路约束)
- **Foundry** (`forge` 和 `anvil`)
- **Circom** (可选，用于重新编译 `.circom` 逻辑)

### 1. 编译并运行本地 Rust 密码学测试
```bash
# 编译并执行客户端本地单元测试 (包含 DKG 流程与钱包测试)
cargo +nightly test -p compliant-privacy-stablecoin-client
```

### 2. 生成 DKG 测试数据 JSON
在发起任何链上广播前，需运行 DKG 生成二进制，将多节点生成的随机多项式承诺、加密碎片和全局审计公钥写入配置文件：
```bash
cargo +nightly run --bin dkg_gen
```
*输出路径*：`contracts/test/dkg_test_data.json`

### 3. 智能合约测试 (Forge Fork Simulation)
```bash
cd contracts
# 安装依赖
forge install
# 本地沙盒分叉测试
forge test -vvv
```

### 4. 运行全流程端到端链上测试 (E2E On-chain Broadcast)

利用 Anvil 模拟真实区块链环境，发起包括部署、DKG 完成、Alice 存款、Alice 隐私转账给 Bob、Bob 取款的全业务流程：

```bash
# 步骤 A: 启动本地 Anvil 开发节点 (保持后台运行)
anvil --host 127.0.0.1 --port 8545

# 步骤 B: 运行全流程交互脚本并将真实交易广播发布到 Anvil 链上
cd contracts
forge script script/TestFullE2EFlow.s.sol:TestFullE2EFlowScript --rpc-url http://127.0.0.1:8545 --broadcast --legacy

# 步骤 C: 运行 Rust 审计监督客户端抓取 Anvil 链上日志并执行门限解密
cd ..
cargo +nightly run --bin audit_full_verify
```

---

## 🔒 密码学与审计防线机制

- **Note (资金凭证)**: $Note = \{amount, secret, blinding\}$。
- **Commitment (公开承诺值)**: $Commitment = Poseidon(amount, secret, blinding)$。
- **Nullifier (双花防御无效符)**: $Nullifier = Poseidon(secret, leaf\_index)$。
- **混合加密双向承诺 (Hybrid Encryption)**:
  - 链下：用户基于 DKG 阶段聚合生成的 `globalAuditPublicKey` 加密一笔交易的临时对称密钥，密文保存至链上 `Transact` 事件。
  - 链上 ZK 电路约束：电路强制约束 Poseidon 对称哈希加密的交易详情与上链的对称密钥属同一来源。
  - 审计解密：3/5 门限私钥碎片（基于拉格朗日系数 $\lambda_j$ 计算局部解密点 $D_j = sk_j \cdot R$）重组共享秘密，最终在不泄露各节点私钥的前提下，还原交易明文。

---

## 📄 许可证

Apache-2.0
