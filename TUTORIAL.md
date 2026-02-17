# 从零构建隐私 ERC20 代币：零知识证明实战教程

本教程旨在帮助对零知识证明 (ZK) 不熟悉的开发者，一步步理解并构建一个基于 **Circom** 和 **Solidity** 的隐私代币系统。

我们不堆砌复杂的数学公式，而是通过“功能需求 -> 解决方案”的方式来拆解这个项目。

---

## 📚 第一章：核心概念 (Mental Model)

在开始写代码之前，我们需要转换一下思维方式。

### 1.1 公开账本 vs 隐私账本

*   **以太坊 (ERC20)**: 像大家一起记在黑板上的流水账。
    > "Alice 给 Bob 转了 10 个币" —— 全类人都能看见。
*   **隐私代币 (类似 Zcash/Tornado)**: 像每人手里的存钱罐 (Note)。
    > "我有一个存钱罐，只有我知道密码。我现在把这个存钱罐销毁，变出两个新存钱罐给别人。" —— 别人只看到存钱罐的变化，不知道是谁给谁。

### 1.2 隐私交易的四个魔法单词

为了实现上述功能，我们需要四个核心概念：

1.  **Note (票据)**: 代表资产的数据包。
    *   包含：`金额` + `秘密` (Secret)。
    *   *类比：一张写着金额和密码的支票。*
2.  **Commitment (承诺)**: Note 的加密指纹。
    *   `Hash(金额, 秘密)`。
    *   上链的是 Commitment，不是 Note。大家知道有人存了一笔钱，但不知道是多少，是谁的。
3.  **Merkle Tree (默克尔树)**: 记录所有存在的 Commitments。
    *   用来证明“我的这张 Note 确实是在合约里存在的”，而不需要遍历整个账本。
4.  **Nullifier (无效符)**: 防止双花。
    *   `Hash(秘密, 索引)`。
    *   每张 Note 都有一个唯一的 Nullifier。花费 Note 时，我们必须公开这个 Nullifier。合约检查：如果 Nullifier 没见过，交易通过；如果见过，说明这张 Note 已经被花过了。

---

## 🛠 第二章：环境搭建

你需要安装以下工具：

1.  **Rust**: 用于编写客户端逻辑。
2.  **Node.js**: 用于 Circom 的依赖。
3.  **Foundry**: 以太坊开发框架。
4.  **Circom**: 电路编译器。

```bash
# 1. 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 2. 安装 Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# 3. 安装 Circom
git clone https://github.com/iden3/circom.git
cd circom && cargo build --release && cargo install --path circom

# 4. 安装 SnarkJS
npm install -g snarkjs
```

---

## 🏗 第三章：编写电路 (The Judge)

电路 (`.circom`) 是链下的“法官”。它不执行交易，而是检查交易是否合法。

### 3.1 我们的目标
我们需要一个电路，向它证明：“我知道一个秘密 `s`，它的哈希在 Merkle 树里。我现在要把它废弃，生成一个新秘密 `s'`。”

### 3.2 核心代码解析 (`circuits/circom/joinsplit.circom`)

看看我们的 `JoinSplit` 电路做了什么：

```circom
template JoinSplit(levels) {
    // === 公开输入 (大家都能看见) ===
    signal input root;          // 当前 Merkle 树根
    signal input nullifier;     // 我要废弃的 Note 的防双花标记
    signal input commitment;    // 我要新生成的 Note 的指纹

    // === 私有输入 (只有我知道) ===
    signal input secret;        // Note 的秘密
    signal input pathElements[levels]; // Merkle 证明路径

    // === 逻辑检查 1: 证明我知道秘密 ===
    // 计算 Nullifier 应该是什么
    component nHasher = Poseidon(2);
    nHasher.inputs[0] <== secret;
    nHasher.inputs[1] <== ...;
    // 断言：计算出的 Nullifier 必须等于公开声明的 Nullifier
    nHasher.out === nullifier;

    // === 逻辑检查 2: 证明 Note 存在于树上 ===
    // 使用 MerkleTreeChecker 组件验证 secret 对应的 commitment 是否在 root 这棵树下
}
```

**关键点**：`signal input` 定了输入，`===` 定义了约束。如果任何约束不满足，生成的 Proof 就是无效的。

---

## 🛡 第四章：编写合约 (The Gatekeeper)

合约 (`ShieldedPool.sol`) 是链上的“守门人”。

### 4.1 存款 (Deposit) -> 铸造隐私币
存款其实就是：**把 ERC20 代币锁定，然后在 Merkle 树上挂一个 Commitment**。

```solidity
function deposit(bytes32 commitment, uint256 amount) external {
    // 1. 转走用户的 ERC20 代币
    token.transferFrom(msg.sender, address(this), amount);
    
    // 2. 把 commitment 挂在 Merkle 树上
    _insert(commitment);
}
```

### 4.2 转账/提款 (Transact) -> 花费隐私币
这是最复杂的一步。用户不直接说“我要花这个 Note”，而是扔给合约一个 **ZK Proof**。

```solidity
function transact(
    bytes calldata proof, 
    bytes32 root, 
    bytes32 nullifier, 
    ...
) external {
    // 1. 检查 Root: 这个 Merkle 根是我们历史记录里的吗？
    require(roots[root], "Invalid root");

    // 2. 检查 Nullifier: 这个 Note 被花过吗？
    require(!nullifiers[nullifier], "Double spend");

    // 3. 验证 Proof: 呼叫 Verifier 检查电路逻辑
    // "这个人证明了他拥有 root 下的某张 Note，且生成了正确的 nullifier"
    require(verifier.verifyProof(proof, ...), "Invalid proof");

    // 4. 标记 Nullifier 已使用
    nullifiers[nullifier] = true;

    // 5. 执行操作 (比如把钱转给别人，或者插入新的 Commitment)
}
```

---

## 💻 第五章：实战操作

现在我们就在本通过脚本把这一切跑起来。

### 步骤 1: 编译电路
这步会生成 `Verifier.sol` (验证合约) 和 `.zkey` (证明键)。

```bash
./scripts/compile_circuits.sh
```

### 步骤 2: 编译 Rust 客户端
Rust 客户端用来在本地生成 Proof。

```bash
cargo build --release
```

### 步骤 3: 运行测试
我们在合约中写了完整的测试流程。

```bash
cd contracts && forge test
```

如果看到 `[PASS]`，恭喜你！你已经成功运行了一个基于零知识证明的隐私代币系统。

---

## 🚀 进阶思考

1.  **中继器 (Relayer)**: 在我们的系统中，如果 Alice 转账给 Bob，Alice 需要消耗 Gas。为了完全匿名（不暴露 Gas 支付地址），通常引入 Relayer 代付 Gas，并从转账金额中抽取费用。
2.  **合规性**: 如何在保护隐私的同时防止洗钱？这通常涉及到 View Key (查看密钥) 的机制，允许监管机构在特定授权下查看交易内容。

希望这篇教程能帮你打开 ZK 开发的大门！
