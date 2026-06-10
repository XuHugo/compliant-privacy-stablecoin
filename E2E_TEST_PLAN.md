# 隐私 ERC20 协议端到端（E2E）测试实施计划

本计划旨在从零开始，对隐私 ERC20 项目的**电路编译、链上合约、链下客户端以及合规审计模块**进行全面的端到端（E2E）测试，确保各组件在集成状态下功能完整且安全。

## 核心测试目标
1. **编译链条测试**：验证 `.circom` 成功生成 ZK 证明钥匙、Wasm 辅助程序和 `Verifier.sol` 合约。
2. **链上存取与交易测试**：测试本地 EVM 网络上 `ShieldedPool` 合约的 Deposit（存款）和 Transact（划转/取款）。
3. **ZK 密码学验证测试**：测试本地生成的 ZK Proof 与链上 Verifier 的配对验证。
4. **合规性（POI & Audit）测试**：测试干净树根拦截机制（防洗钱）与 3-of-5 门限加密解密审计流程。

---

## 🛠️ 测试步骤规划

### 第一步：环境就绪检查 (Environment Check)
在执行任何测试前，需确认 WSL 中以下工具链版本符合要求：
*   **Rust** (>= 1.70.0 nightly)
*   **Node.js** (>= 16.0.0)
*   **Circom** (>= 2.0.0)
*   **Foundry** (包含 `forge` 和 `anvil`)

### 第二步：依赖安装与电路编译 (Compile & Setup)
1.  在根目录下运行 `npm install` 载入 `circomlib` 电路依赖。
2.  执行 `./scripts/compile_circuits.sh` 编译 `joinsplit.circom` 电路，运行可信设置生成 `Verifier.sol`。

### 第三步：链下客户端密码学与本地约束测试 (Rust Client Test)
运行 Rust 测试套件，确保：
1.  本地钱包正确生成 Note 并能在本地重构 Merkle 树。
2.  DKG（分布式密钥生成）和 3-of-5 联合解密算法在本地正常通过。
3.  电路 Witness 本地约束校验（`verify_constraints`）无逻辑报错。

### 第四步：链上合约部署与场景化集成测试 (EVM Integration Test)
1.  进入 `contracts` 目录安装 Foundry 依赖（`forge install`）。
2.  启动本地开发网节点 `anvil`。
3.  通过 `forge test -vvv` 运行智能合约的集成测试，覆盖：
    *   `testDeposit()`：普通存款流程。
    *   `testTransact()`：ZK 证明驱动的隐私提款流程。
    *   `testTransactPOI()`：合规干净树根（POI）白名单双向拦截流程。
    *   `testTransactFailMEVFrontRun()`：防 MEV 抢跑保护（地址与 Proof 绑定校验）。

---

## 📋 待确认问题 (Open Questions)
> [!IMPORTANT]
> 1. 您的 WSL 环境中目前是否已全部安装 `circom`、`snarkjs` 和 `foundry`？如果有未安装的，我们需在测试开始前进行安装。
> 2. 我们是否需要编写一个额外的自动化 JS/Rust 脚本，用来在 Anvil 本地节点上运行一个完整的“从存款到提款”的命令行交互演示？还是只运行现有的测试套件（Rust Suite + Forge Suite）即可？

---

## 🔍 验证方案 (Verification Plan)

### 自动化测试执行命令
*   **电路与客户端单元测试**：
    ```bash
    cargo +nightly test --workspace
    ```
*   **智能合约集成测试**：
    ```bash
    cd contracts && forge test -vvv
    ```
