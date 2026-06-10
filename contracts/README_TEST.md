# 智能合约测试与部署指南 (Foundry)

本项目使用 **Foundry (Forge)** 作为智能合约的编译、测试和部署开发框架。所有的测试用例和部署流程均通过 Solidity 脚本实现。

---

## 📂 测试与部署文件结构

```
contracts/
├── src/                  # 合约源代码
├── test/                 # 测试用例 (Solidity 编写)
│   ├── ShieldedPool.t.sol  # 主池端到端业务集成测试
│   └── AuditRegistry.t.sol # 审计节点 DKG 状态测试
├── script/               # 部署与执行脚本 (Solidity 编写)
│   └── Deploy.s.sol      # 本地一键部署所有合约的脚本
├── Poseidon_bytecode.txt # 预编译好的 Poseidon 哈希 EVM 字节码
└── foundry.toml          # Foundry 配置文件
```

---

## 🛠️ 核心脚本说明

### 1. 部署脚本: `contracts/script/Deploy.s.sol`
这是一个 Solidity 编写的**链上部署脚本**。当你通过 `forge script` 运行它时，它会执行以下动作：
*   **部署 MockToken**：铸造 `1000000` 个模拟 ERC20 代币 (MCK)。
*   **部署 Poseidon 哈希合约**：
    由于 Poseidon 算法极度复杂，脚本通过 Foundry 的 Cheatcode `vm.readFile` 读取根目录的 `Poseidon_bytecode.txt` 十六进制字节码，并使用 Yul 汇编 `create` 指令直接在本地网络部署。
*   **部署 Verifier.sol**：部署编译电路生成的 Groth16 ZK 验证合约。
*   **部署 ShieldedPool.sol**：关联上面的 Token、Verifier 和 Poseidon 部署合约。
*   **部署 AuditRegistry.sol**：初始化注册 5 个模拟的审计节点地址。

### 2. 测试脚本: `contracts/test/ShieldedPool.t.sol`
这套测试用例模拟了真实用户钱包与智能合约的全部交互：
*   `testDeposit()`：测试用户直接向池子存钱，断言 ERC20 余额成功划转，并验证 Merkle 树的当前叶子索引和 Root 是否正确更新。
*   `testTransact()`：模拟隐私提现。利用伪造的 ZK 证明数据，测试资金流出、Nullifier 防双花以及找零 Commitment 重新插入 Merkle 树的完整流。
*   `testTransactFailMEVFrontRun()`：防抢跑测试。模拟黑客窃取 ZK 证明并试图篡改提款接收人（Recipient）时，合约与验证器是否能准确识别并拦截。
*   `testTransactPOI()`：合规 POI 测试。测试用户提供不在 approved 列表中的干净树根时，合约能否通过 `approvedCleanRoots` 成功拦截黑钱提现。

---

## 🚀 运行命令手册

### 步骤 1：启动本地 Anvil 节点
在后台启动一个本地区块链节点以模拟主网环境：
```bash
# 启动本地 EVM 开发网，监听 8545 端口
anvil --host 127.0.0.1 --port 8545
```

### 步骤 2：部署合约到 Anvil 节点
使用我们编写的部署脚本将所有合约一键部署到本地节点中：
```bash
# 进入合约目录
cd contracts

# 运行部署脚本并将交易广播发布到 Anvil 链上
forge script script/Deploy.s.sol:DeployScript --rpc-url http://127.0.0.1:8545 --broadcast
```

### 步骤 3：对已部署的合约执行真实链上交互与广播测试

> [!WARNING]
> 直接运行 `forge test --rpc-url http://127.0.0.1:8545` 只是在本地内存沙盒（Sandbox）中分叉（Fork）了该网络状态，测试过程中的所有状态修改**并不会**提交或持久化到你运行的 Anvil 节点中。
> 
> 如果要测试**真实部署在 Anvil 节点上的合约**，必须执行广播脚本，向 Anvil 节点发送并持久化真实的链上交易：

```bash
# 运行真实链上交互脚本并广播交易，直接修改本地 Anvil 节点的合约状态
forge script script/TestLiveContracts.s.sol:TestLiveContractsScript --rpc-url http://127.0.0.1:8545 --broadcast --legacy
```

> [!TIP]
> **本地调试小技巧**：在执行 `forge script` 时加上 `--broadcast`，可以在 Anvil 终端看到实时的交易打包日志（例如 `eth_sendRawTransaction`）。这才是真正的端到端集成测试！

