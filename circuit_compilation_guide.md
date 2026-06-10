# 零知识证明电路编译与可信设置（Trusted Setup）通俗指南

零知识证明（ZK）技术由于涉及到高深的数学和密码学，对于初学者来说往往像魔法一样神秘。本项目中的 `compile_circuits.sh` 脚本就是用来将零知识证明的**“电路逻辑”**转化为**“链上合约与数学钥匙”**的流水线。

本指南旨在用最通俗易懂的语言，为你拆解这个脚本在每一步到底做了什么。

---

## 💡 核心比喻：如何理解 ZK 编译？

如果把零知识证明比作**“一场在法庭上的自证清白”**，那么编译过程就是在做三件事：

1.  **写法律条款（编译电路）**：把法庭判案的逻辑定义好（比如：金额必须守恒）。
2.  **制造公证处的钢印（可信设置）**：制造一把特殊的数学钥匙，这把钥匙用来给你的证据盖上“防伪钢印”。
3.  **培训法官（导出 Solidity 合约）**：生成一个链上智能合约（Verifier.sol），它不懂复杂的数学，但只要看到带有“防伪钢印”的证明，就能瞬间判断你是否清白。

---

## 🛠️ 脚本命令逐段拆解

下面我们按照 `compile_circuits.sh` 脚本执行的顺序，一步步分析：

### 第一步：环境与依赖检查

```bash
# 检查是否安装了 circom 编译器
if ! command -v circom &> /dev/null; then ... exit 1; fi
# 检查是否安装了 snarkjs 命令行工具
if ! command -v snarkjs &> /dev/null; then ... exit 1; fi
```
*   **大白话**：先看看你的系统里有没有安装 **Circom**（电路画笔）和 **SnarkJS**（数学钥匙生成器）。没有它们，后续的魔法就无法施展。

---

### 第二步：编译电路

```bash
circom $CIRCUITS_DIR/joinsplit.circom --r1cs --wasm --sym --c --output $BUILD_DIR -l node_modules
```
*   **大白话**：把我们手写的高级电路文件 `joinsplit.circom`（里面用代码规定了转账的规则）编译成计算机和密码学算法能听懂的底层格式。
*   **生成的关键产物**：
    *   **`.r1cs` 文件**：电路的“几何约束”，即电路包含的所有代数方程关系。
    *   **`.wasm`（或 C 语言）文件**：用来在本地输入用户的私有数据（明文），快速计算出所有电路节点的中间值（也叫生成 Witness）。

---

### 第三步：第一阶段可信设置（Powers of Tau - 普适信任源）

这一步类似于**“铸造一把万能铜锁的基底”**。这个阶段产生的“信任”，是所有类似大小的电路都可以通用的。

```bash
# 1. 创建一个新的公共信任源（基于 BN128 曲线，支持最大 2^16 个约束）
snarkjs powersoftau new bn128 16 $BUILD_DIR/pot16_0000.ptau -v

# 2. 注入随机性（贡献熵）
snarkjs powersoftau contribute $BUILD_DIR/pot16_0000.ptau $BUILD_DIR/pot16_0001.ptau --name="First contribution" -v -e="random text"

# 3. 准备 Phase 2
snarkjs powersoftau prepare phase2 $BUILD_DIR/pot16_0001.ptau $BUILD_DIR/pot16_final.ptau -v
```
*   **为什么要注入随机性？**
    零知识证明的安全建立在**“毒药（Toxic Waste）”**的销毁上。生成钥匙时需要用到随机的数学秘密。如果这个秘密泄露，任何人都可以凭空伪造清白证明。
*   **大白话**：为了防止单个人作恶，我们需要大家一起往这把万能锁上胡乱“吹一口气”（提供随机数熵贡献）。只要参与贡献的这群人里有一个人是诚实的，并且在生成后销毁了本地的随机秘密，这把锁就是绝对安全的。

---

### 第四步：第二阶段可信设置（Groth16 专用设置）

这一步是**“针对我们手写的 joinsplit 电路，把万能锁熔化成专用的专属锁”**。

```bash
# 1. 结合我们的电路（.r1cs）和万能锁（.ptau），生成针对 joinsplit 的专属初始钥匙 (zkey)
snarkjs groth16 setup $BUILD_DIR/joinsplit.r1cs $BUILD_DIR/pot16_final.ptau $BUILD_DIR/joinsplit_0000.zkey

# 2. 再次注入随机性，保障专属钥匙的安全
snarkjs zkey contribute $BUILD_DIR/joinsplit_0000.zkey $BUILD_DIR/joinsplit_final.zkey --name="Second contribution" -v -e="another random text"

# 3. 导出验证密钥（Verification Key）
snarkjs zkey export verificationkey $BUILD_DIR/joinsplit_final.zkey $BUILD_DIR/verification_key.json
```
*   **生成的关键产物**：
    *   `joinsplit_final.zkey`：**证明密钥（Proving Key）**。这是钱包客户端放在本地的，只有用这把钥匙，配合你自己的私密资产（秘密值、金额），才能生成清白证明。
    *   `verification_key.json`：**验证密钥**。这是一个纯数学描述，任何人都可以拿它来验证证明的真伪。

---

### 第五步：导出 Solidity 验证合约

```bash
snarkjs zkey export solidityverifier $BUILD_DIR/joinsplit_final.zkey $CONTRACTS_DIR/Verifier.sol
```
*   **大白话**：将上一步生成的“验证密钥”打包进一个标准的 Solidity 智能合约中，并命名为 `Verifier.sol`。
*   **生成的关键产物**：
    *   **`Verifier.sol` 合约**：将它部署到以太坊上后。当用户发送隐私转账时，`ShieldedPool.sol` 合约就会调用这个 `Verifier.sol`。它不关心你的转账细节，只负责在 EVM 链上快速运算几个椭圆曲线乘法，然后告诉你：“这个人的证明确实是真的，放行！”。

---

## 📋 产物速查表

| 生成的文件 | 它是什么？ | 谁在使用它？ |
| :--- | :--- | :--- |
| `joinsplit.wasm` | 电路计算程序 | **客户端（钱包）**：用来通过输入的私密数据计算出“证据明细”。 |
| `joinsplit_final.zkey` | 证明密钥 (Proving Key) | **客户端（钱包）**：用来为明文证据套上防伪数学钢印，生成 ZK Proof。 |
| `Verifier.sol` | 验证合约 (Solidity Verifier) | **链上智能合约**：部署到以太坊，供主资产池自动验证用户 Proof 的真伪。 |
