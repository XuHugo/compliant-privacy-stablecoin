# 隐私 ERC20 端到端（E2E）与真实 DKG 密码学集成测试报告

本报告总结了隐私 ERC20 协议的集成测试结果，特别增加了**链下 Rust 客户端生成真实 DKG 密钥数据与链上 Solidity 合约进行跨语言密码学校验**的测试结果。

---

## 📊 测试结果汇总

| 测试阶段 | 测试命令 | 状态 | 关键验证点 |
| :--- | :--- | :--- | :--- |
| **Step 1: 环境就绪检查** | `wsl rustc; node; circom; forge; anvil` | **Passed 🟢** | 验证工具链版本与路径完整性。 |
| **Step 2: 依赖与电路编译** | `compile_circuits.sh` | **Passed 🟢** | 成功生成 Zkey、Wasm 与链上 `Verifier.sol` 合约。 |
| **Step 3: 链下客户端测试** | `cargo +nightly test` | **Passed 🟢** | 本地钱包 Note、代数哈希和 3-of-5 DKG 门限解密功能正常。 |
| **Step 4: 链上合约集成测试** | `forge test -vvv` | **Passed 🟢** | ZK 证明链上校验、双花防御、防 MEV 抢跑及 POI 白名单过滤正常。 |
| **Step 5: 真实 DKG 数据生成** | `cargo run --bin dkg_gen` | **Passed 🟢** | Rust 客户端在 `alt_bn128` 曲线生成 5 节点多项式 G1 承诺和加密碎片。 |
| **Step 6: Solidity 联合校验** | `forge test --match-contract AuditRegistryTest` | **Passed 🟢** | 合约成功解析 Rust 导出的 DKG JSON 密钥包，验证了全局公钥一致性。 |
| **Step 7: 链上审计交互与解密** | `forge script script/TestAuditLive.s.sol && cargo run --bin audit_verify` | **Passed 🟢** | 交易上链后，Rust 客户端提取 Anvil 的 Event 密文并通过门限私钥成功解密！ |

---

## 🔍 真实 DKG 联合测试运行明细

### 1. 链下真实 DKG 数据导出
*   **执行命令**：
    ```bash
    cargo +nightly run --bin dkg_gen
    ```
*   **动作说明**：
    Rust 客户端在本地执行完整的分布式密钥生成协议。5 个节点在本地计算随机二次多项式，计算 G1 承诺点，并生成加密分发碎片。最终将所有真实数据导出为 `contracts/test/dkg_test_data.json`。
*   **输出成功**：`DKG test data successfully written to contracts/test/dkg_test_data.json`

### 2. 链上 Solidity 密码学联合校验
*   **执行命令**：
    ```bash
    cd contracts && forge test --match-contract AuditRegistryTest -vvv
    ```
*   **测试输出**：
    ```text
    Ran 6 tests for test/AuditRegistry.t.sol:AuditRegistryTest
    [PASS] testConstructorInitialization() (gas: 49854)
    [PASS] testFinalizeGlobalPublicKey() (gas: 61847)
    [PASS] testRealDkgWorkflow() (gas: 3985412) ◄── 真实密码学联合测试通过！
    [PASS] testRegisterCommunicationKey() (gas: 47657)
    [PASS] testSubmitDkgData() (gas: 266660)
    [PASS] testSubmitDkgDataToNonAuditorFails() (gas: 96252)
    Suite result: ok. 6 passed; 0 failed
    ```
*   **业务逻辑校验成功**：
    *   在 `testRealDkgWorkflow` 中，合约通过 `vm.readFile` 读取 Rust 导出的真实密钥包。
    *   5 个真实审计节点调用 `submitDkgData` 提交了真正的 BN254 承诺和分发碎片。
    *   验证了链上最终聚合、公示的 `globalAuditPublicKey` 与链下 Rust 客户端输出的全局公钥（BN254 G1 压缩点十六进制）完全吻合。

### 3. 真实链上交易发送与日志审计解密 (Anvil E2E Integration)
*   **动作说明**：
    1. 运行部署与调用交互脚本，向 Anvil 本地节点广播一笔包含已加密对称密钥 `sample_ciphertext` 的隐私交易（`transact`）。
    2. Anvil 执行交易并在收据中生成并持久化包含该密文的 `Transact` 事件日志。
    3. 运行 Rust 审计解密工具 `audit_verify`。该工具直接解析 Anvil 导出的交易日志文件，检测并捕获其中的加密审计密文。
    4. 模拟三个独立审计人（节点 1、3、5），使用各自的 DKG 私钥碎片对密文计算局部解密份额（$D_j = sk_j * R$）。
    5. 联合三个局部份额，通过 Lagrange 插值还原出原始的对称密钥，并与期望值进行比对校验。
*   **执行命令**：
    ```bash
    # 1. 广播包含密文的交易到 Anvil 节点
    cd contracts && forge script script/TestAuditLive.s.sol:TestAuditLiveScript --rpc-url http://127.0.0.1:8545 --broadcast --legacy
    
    # 2. 运行 Rust 审计客户端抓取 Anvil 日志并执行 3-of-5 联合解密
    cd .. && cargo +nightly run --bin audit_verify
    ```
*   **审计客户端输出成功**：
    ```text
    === 启动链上审计交互与解密验证 ===
    -> 当前工作目录: "/home/zaq1/eth/lambdaworks/privacy-erc20"
    -> 成功读取 DKG 密钥包，获取审计人私钥碎片。
    -> 成功读取 Anvil 链上交易日志（contracts/broadcast/TestAuditLive.s.sol/31337/run-latest.json）
    -> 从 Anvil 交易收据日志（Event Log）中成功截获加密审计密文！
       密文 (Hex): 7d1c4a79e4280af5890910188e66492536fc8ede4bd9f8c5d58118ab349a3e8a77dbc32c336fbed4cfa0c82b9acdbd5a27063fec974778381c5298e3c08bb001
    -> 模拟 3 个审计节点（Node 1, Node 3, Node 5）联合进行门限解密：
       [节点 1] 生成局部解密份额成功
       [节点 3] 生成局部解密份额成功
       [节点 5] 生成局部解密份额成功
    -> 联合门限解密完成！
       解密出的对称密钥 (Hex): 346bc74301000000000000000000000000000000000000000000000000000000
       期望的对称密钥   (Hex): 346bc74301000000000000000000000000000000000000000000000000000000
    === 🟢 审计解密验证成功！已证明可通过链上提取的交易数据联合还原审计密钥。 ===
    ```

---

## 🏆 结论
通过本次优化，我们证明了**链下 Rust 客户端的密码学算法与链上 Solidity 合约的存储/验证数据格式实现了 100% 兼容**。分布式密钥生成（DKG）不再是单纯的字符串分发测试，而是经过了跨语言、真实椭圆曲线数学点传输的严谨校验！
