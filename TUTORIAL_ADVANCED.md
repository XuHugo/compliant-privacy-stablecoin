# 隐私稳定币深度解剖：从系统架构到电路与合约的详细设计教程

本教程旨在为对密码学、零知识证明（ZK）、以太坊智能合约开发感兴趣的开发者，深度解剖本项目中实现的 **Privacy-ERC20 隐私稳定币协议**。

我们将通过**“高层架构（Framework） $\rightarrow$ 核心密码学概念 $\rightarrow$ 电路详细设计（Circom） $\rightarrow$ 合约详细设计（Solidity） $\rightarrow$ 链下客户端（Rust）”**的渐进式路线，带你彻底搞懂如何构建一个具备**防 MEV、双轨合规、门限混合加密审计以及无 Gas 原生体验**的生产级隐私稳定币系统。

---

## 目录
1. [🌟 系统总体框架与双轨合规流](#1-系统总体框架与双轨合规流)
2. [🔑 核心密码学要素 (Data Models)](#2-核心密码学要素-data-models)
3. [⚡ ZK 核心电路详细设计 (`joinsplit.circom`)](#3-zk-核心电路详细设计-joinsplitcircom)
4. [🛡 智能合约详细设计 (`ShieldedPool.sol`)](#4-智能合约详细设计-shieldedpoolsol)
5. [💻 链下客户端与证明准备 (`Rust Client`)](#5-链下客户端与证明准备-rust-client)
6. [🚀 运行、测试与未来升级 roadmap](#6-运行测试与未来升级-roadmap)

---

## 1. 系统总体框架与双轨合规流

传统的隐私交易协议（如旧版 Tornado Cash）采用“绝对无许可”模式。这导致其极易沦为黑客洗钱的温床，进而招致中心化发行商（如 Circle/Tether）对整个屏蔽池地址的拉黑，使普通用户的资产一同冻结。

本项目在设计之初就立足于**“隐私稳定币的实用与合规”**，采用了创新的**双轨制合规（Dual-Track Compliance）**架构。

### 1.1 系统架构图

下面的 Mermaid 图清晰展现了用户、链下合规预言机/DAO、中继器、ZK 电路和区块链智能合约之间的交互：

```mermaid
graph TD
    User((用户钱包)) -->|1. 存款/转账请求| Client[Rust 客户端]
    Oracle[合规预言机/DAO] -->|2. 干净树更新/KYC签名| Client
    Client -->|3. 链下计算 Witness| Witness[生成 ZK 证明]
    Witness -->|4. 提交 Proof 与交易数据| Relayer[Relayer 中继器]
    Relayer -->|5. 代付 Gas 提交 transact()| ShieldedPool[ShieldedPool 智能合约]
    ShieldedPool -->|6. 调用 verifyProof()| Verifier[Verifier 验证合约]
    ShieldedPool -->|7. 转账/提款给接收者| Recipient((接收者地址))
    ShieldedPool -->|8. 支付中继手续费| Relayer
```

### 1.2 双轨合规流详述

*   **轨道 A（去中心化合规：无辜证明 - Proof of Innocence, POI）**：
    *   **思想**：存款阶段完全自由。提款阶段，用户必须证明自己的资金来源于一个**“干净的存款集合”**。
    - **流程**：链下合规节点或安全 DAO 维护一棵排除了已知黑名单（如黑客关联地址）的 Merkle 树（称为 Clean Tree）。用户提款生成 Proof 时，电路强制校验**“我的存款 Note 既在总 Merkle 树上，也在干净的 Merkle 树上”**。
*   **轨道 B（中心化合规：前置审查与签名 - Pre-KYC/AML）**：
    - **思想**：在资金进入隐私池前，直接把黑钱拦截在外面。
    - **流程**：用户存款前，前端发起 KYC/AML 地址审查。通过后，合规节点用其私钥对该用户的 `commitment` 签名。智能合约存款方法强校验该 ECDSA 签名，签名不符则拒绝入金。

---

## 2. 核心密码学要素 (Data Models)

在隐私代币系统中，资产的表示与流转不再是通过数据库中的“账户余额减去、增加”，而是类似于 Zcash 的 **UTXO (Unspent Transaction Output)** 模型。我们称之为 **Note（票据）**。

### 2.1 Note (票据) 的数据结构
在 `circuits/src/note.rs` 中定义：
```rust
pub struct Note {
    pub amount: u64,      // 票据代表的金额
    pub secret: FE,       // 用户私钥派生的秘密值 (用于自证拥有权)
    pub blinding: FE,     // 盲化因子 (大随机数，确保防暴力破解与防关联)
}
```

### 2.2 Commitment (承诺)
为了在链上公开这笔资产但又不泄露金额和所有者，我们计算其哈希值上链，称为 **Commitment（承诺）**：
$$\text{Commitment} = \text{Poseidon}(\text{amount}, \text{secret}, \text{blinding})$$
所有的 Commitments 会被增量插入到智能合约管理的 **Merkle 树** 中。

### 2.3 Nullifier (无效符)
当用户想要花费某个 Note 时，必须在链上出示一个唯一的作废声明，称为 **Nullifier（无效符）**。
$$\text{Nullifier} = \text{Poseidon}(\text{secret}, \text{leaf\_index})$$
*   **leaf\_index**：该 Note 的 Commitment 在 Merkle 树中的叶子索引。
*   **防双花原理**：因为同一张 Note 的 `secret` 和 `leaf_index` 是固定唯一的，所以其计算出的 `Nullifier` 也是唯一的。合约一经记录该 Nullifier 为“已使用”，就彻底断绝了该 Note 被二次消费（双花）的可能。

> [!TIP]
> **为什么选择 Poseidon 哈希而不是 Keccak256？**
> Keccak256 / SHA256 包含大量的位元运算（AND, XOR, ROTATE），在基于素数域算术电路（R1CS）的零知识证明中，其约束数量（Constraint count）极其庞大（高达数十万）。而 **Poseidon** 是专为代数和 ZK 设计的友好哈希算法，在 BN254 域下的约束极少，能提升证明生成速度上百倍！

---

## 3. ZK 核心电路详细设计 (`joinsplit.circom`)

`joinsplit.circom` 是整个协议中链下“法官”的核心实现。它定义了隐私转账（即花费 2 个输入 Notes，生成 2 个输出 Notes）的全部安全约束条件。

让我们进入电路 `circuits/circom/joinsplit.circom` 的源码逐段解析。

### 3.1 公开与私有输入定义
```circom
template JoinSplit(levels) {
    // === 公开输入 (Public Inputs, 链上可见) ===
    signal input root;                 // 交易发生时的 Merkle 树根
    signal input cleanTreeRoot;        // 轨道 A: 干净树根 (POI)
    signal input nullifier1;           // 输入 Note 1 的双花标记
    signal input nullifier2;           // 输入 Note 2 的双花标记
    signal input commitment1;          // 新生成的输出 Note 1 的承诺
    signal input commitment2;          // 新生成的输出 Note 2 的承诺
    signal input publicAmount;         // 公开存入/提款金额 (正=存入, 负=提取)
    signal input fee;                  // 支付给中继器的手续费
    signal input recipient;            // 接收地址
    signal input relayer;              // 中继器地址
    signal input auditCiphertext[4];   // 门限加密审计密文

    // === 私有输入 (Private Inputs / Witness, 仅证明者知晓) ===
    signal input symKey;               // 链下一次性对称密钥 (用于审计加密)
    // 输入 Note 1 及 Merkle 路径证明
    signal input inAmount1;
    signal input inSecret1;
    signal input inBlinding1;
    signal input inPathIndices1[levels];
    signal input inPathElements1[levels];
    signal input inCleanPathIndices1[levels];
    signal input inCleanPathElements1[levels]; // POI 路径
    ...
```

### 3.2 深度设计 1：防 MEV 抢跑绑定设计 (MEV Protection)
如果提款目标地址 `recipient` 只作为智能合约入参，而不被约束进 Proof 内部，黑客就可以从公链的 mempool 截获该笔交易，替换 `recipient` 为黑客自己的地址，并原封不动套用 Proof 发送交易。
电路使用以下代码进行强制绑定：
```circom
    // 0. MEV Protection (Bind recipient and relayer)
    signal dummyRecipient;
    dummyRecipient <== recipient * recipient;
    signal dummyRelayer;
    dummyRelayer <== relayer * relayer;
```
*   **原理**：虽然 `dummyRecipient` 是个无意义的约束乘积，但它强制使公开输入 `recipient` 成为 R1CS 电路约束树中的一个活跃节点。如果恶意中继者在链上交易中篡改了 `recipient`，该值与 Proof 生成时使用的 `recipient` 不匹配，验证合约必然拒绝！

### 3.3 深度设计 2：余额守恒约束 (Balance Conservation)
隐私转账的数学本质是“旧票据的销毁”与“新票据的创建”，且总金额必须守恒：
$$\text{inAmount1} + \text{inAmount2} + \text{publicAmount} = \text{outAmount1} + \text{outAmount2} + \text{fee}$$
```circom
    // 1. Verify Balance Conservation
    signal inputSum;
    inputSum <== inAmount1 + inAmount2 + publicAmount;
    
    signal outputSum;
    outputSum <== outAmount1 + outAmount2 + fee;

    inputSum === outputSum;
```

### 3.4 深度设计 3：双重 Merkle 证明 (总树与干净树)
这是轨道 A（无辜证明 POI）在电路内的核心实现。对于输入的 Note 1，电路需要验证它同时存在于大 Merkle 树（`root`）和干净 Merkle 树（`cleanTreeRoot`）中：
```circom
    // 计算输入 Note 1 的 Commitment
    component c1 = Poseidon(3);
    c1.inputs[0] <== inAmount1;
    c1.inputs[1] <== inSecret1;
    c1.inputs[2] <== inBlinding1;

    // 验证在大树上的存在性
    component tree1 = MerkleTreeChecker(levels);
    tree1.leaf <== c1.out;
    tree1.root <== root;
    for (var i = 0; i < levels; i++) {
        tree1.pathElements[i] <== inPathElements1[i];
        tree1.pathIndices[i] <== inPathIndices1[i];
    }

    // 验证在干净树上的存在性 (自证清白)
    component cleanTree1 = MerkleTreeChecker(levels);
    cleanTree1.leaf <== c1.out;
    cleanTree1.root <== cleanTreeRoot;
    for (var i = 0; i < levels; i++) {
        cleanTree1.pathElements[i] <== inCleanPathElements1[i];
        cleanTree1.pathIndices[i] <== inCleanPathIndices1[i];
    }
```

### 3.5 深度设计 4：轻量级对称加密流密码 (Hybrid Auditing)
为了提供对合规机构的多中心追溯审计，电路实现了一套基于 Poseidon 哈希流密码的对称加密。用户传入一次性对称密钥 `symKey`，电路内以流密码形式加密明文 `[outAmount1, outAmount2, recipient, relayer]`，并将结果约束等于公开的 `auditCiphertext[4]`：
```circom
    // 加密 outAmount1: auditCiphertext[0] = outAmount1 + Poseidon(symKey, 0)
    component ks1 = Poseidon(2);
    ks1.inputs[0] <== symKey;
    ks1.inputs[1] <== 0;
    auditCiphertext[0] === outAmount1 + ks1.out;

    // 加密 outAmount2: auditCiphertext[1] = outAmount2 + Poseidon(symKey, 1)
    component ks2 = Poseidon(2);
    ks2.inputs[0] <== symKey;
    ks2.inputs[1] <== 1;
    auditCiphertext[1] === outAmount2 + ks2.out;
    
    // 同理加密 recipient 和 relayer ...
```
*   **解密审计过程**：司法或审计机构通过 3/5 门限私钥解开链下的非对称密文 $C_1$ 获得原始的 `symKey`。然后，在链下使用同样的 Poseidon 密钥流运算：`outAmount1 = auditCiphertext[0] - Poseidon(symKey, 0)`，即可瞬间恢复完全的明文交易流水，让脏钱无所遁形！

---

## 4. 智能合约详细设计 (`ShieldedPool.sol`)

智能合约是链上的资产守护神，负责验证由 Circom 生成的零知识证明，并将状态更新到 Merkle 树中。

### 4.1 Merkle 树的增量更新算法
如果在智能合约中每次都从头循环计算 Merkle 树节点，Gas 费会极其高昂，甚至超出区块上限。
`ShieldedPool.sol` 采用了一种**增量 Merkle 树更新算法**，仅需记录当前树的右侧边界节点（存储在 `filledSubtrees` 数组中），即可在 $O(\log N)$ 复杂度下完成插入。

在 `contracts/src/ShieldedPool.sol` 中的插入逻辑实现如下：
```solidity
    function _insert(bytes32 leaf) internal {
        uint256 currentIndex = nextLeafIndex;
        bytes32 currentHash = leaf;

        for (uint256 i = 0; i < TREE_HEIGHT; i++) {
            if (currentIndex % 2 == 0) {
                // 如果是左子节点，将当前哈希存入右侧边缘缓存
                filledSubtrees[i] = currentHash;
                // 右侧暂时用预计算的“零值” zeros[i] 填充进行下一步计算
                currentHash = _hashPair(currentHash, zeros[i]);
            } else {
                // 如果是右子节点，读取缓存的左兄弟节点进行配对哈希
                currentHash = _hashPair(filledSubtrees[i], currentHash);
            }
            currentIndex /= 2;
        }

        leaves[nextLeafIndex] = leaf;
        nextLeafIndex++;

        // 记录新树根
        roots[_computeRoot()] = true;
    }
```

### 4.2 存款与 EIP-2612 Permit
对于轨道 B，如果设置了 `complianceSigner`，存款时合约不仅会执行 `ERC20Permit` 实现一键无 Gas 存款，还会强制验证合规签名：
```solidity
    function depositWithPermitAndCompliance(
        bytes32 commitment,
        uint256 amount,
        uint256 deadline,
        uint8 v, bytes32 r, bytes32 s,
        bytes calldata complianceSignature
    ) external nonReentrant {
        ...
        // 轨道 B：强校验合规签名
        if (complianceSigner != address(0)) {
            bytes32 messageHash = keccak256(abi.encodePacked(commitment, msg.sender, amount));
            bytes32 ethSignedMessageHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
            address signer = ECDSA.recover(ethSignedMessageHash, complianceSignature);
            require(signer == complianceSigner, "Invalid compliance signature");
        }

        // 调用 ERC20 Permit 授权
        IERC20Permit(address(token)).permit(msg.sender, address(this), amount, deadline, v, r, s);
        // 转账
        token.safeTransferFrom(msg.sender, address(this), amount);
        // 增量插入树中
        _insert(commitment);
        ...
    }
```

### 4.3 核心交易逻辑：`transact` 校验
当用户进行隐私划转或提款时，提交 Proof。合约需将接收者 `recipient`、中继手续费 `fee`、门限审计密文等拼装为严格排布 of 14 个 `Public Inputs` 数组，最终传递给 `IVerifier` 合约验证：
```solidity
        uint256[14] memory publicInputs;
        publicInputs[0] = uint256(root);
        publicInputs[1] = uint256(cleanTreeRoot); // 轨道 A: 干净根
        publicInputs[2] = uint256(nullifier1);
        publicInputs[3] = uint256(nullifier2);
        publicInputs[4] = uint256(commitment1);
        publicInputs[5] = uint256(commitment2);
        publicInputs[6] = uint256(uint256(publicAmount));
        publicInputs[7] = fee;                    // 手续费绑定
        publicInputs[8] = uint256(uint160(recipient)); // 接收地址绑定 (防MEV)
        publicInputs[9] = uint256(uint160(relayer));   // 中继地址绑定
        publicInputs[10] = auditCiphertext[0];    // 审计解密流 1
        publicInputs[11] = auditCiphertext[1];    // 审计解密流 2
        publicInputs[12] = auditCiphertext[2];
        publicInputs[13] = auditCiphertext[3];

        require(IVerifier(verifier).verifyProof(a, b, c, publicInputs), "Invalid proof");
```
验证通过后，将旧 Note 的 `Nullifier` 标记为 `true`（防止双花），并将新 Note 的承诺值插入树中。

---

## 5. 链下客户端与证明准备 (`Rust Client`)

零知识证明（ZK）中，链上验证（Verify）是非常便宜的，但链下生成证明（Prove / Witness Generation）却极消耗计算资源。这需要一个高度优化的链下客户端。

### 5.1 本地 Merkle 树模拟器与 Proof 准备
Rust 客户端通过 `circuits/src/merkle.rs` 在链下建立一棵一模一样的 Merkle 树，在生成交易前：
1. 从链上同步所有历史 commitments，在本地重构 Merkle Tree 结构。
2. 调用 `tree.get_path(leaf_index)` 获取指定叶子节点的哈希兄弟序列（`siblings`）与路径方向（`path_indices`）。
3. 拼装成电路所需的 Witness `PrivateInputs` 传给 Prover 生成 Proof。

### 5.2 Rust 的 Witness 本地约束校验
在将庞大的 witness 传给 C 语言/Wasm 执行的 ZK Prover 前，为了防止无效计算，Rust 客户端在 `circuits/src/joinsplit.rs` 中实现了一套同等约束逻辑的**“链下约束校验器”**：
```rust
    pub fn verify_constraints(&self) -> Result<(), CircuitError> {
        // 1. 本地校验余额守恒
        self.verify_balance_conservation()?;
        // 2. 本地校验输入 Note 1 的 Merkle 成员证明是否成立
        self.verify_merkle_membership_1()?;
        // 3. 本地校验 Nullifier 1 的派生计算是否正确
        self.verify_nullifier_1()?;
        ...
        Ok(())
    }
```
这能以极短的时间（毫秒级）瞬间反馈给用户，钱包输入或同步路径是否有错误，极大地改善了前端交互体验。

---

## 6. 运行、测试与未来升级 roadmap

通过深入解剖整个系统的框架和细节，我们可以很容易地将该项目跑起来，并对其未来演进路线做出清晰的规划。

### 6.1 开发者实战启动命令

1. **编译电路与生成 Trusted Setup 文件**（在 Docker/WSL 中）：
   ```bash
   cd privacy-erc20
   # 编译 circom 并执行 trusted setup (Groth16)，生成 Verifier.sol 合约
   ./scripts/compile_circuits.sh
   ```

2. **运行 Rust 客户端测试**（使用 Nightly Rust 编译器）：
   ```bash
   cargo +nightly test --workspace
   ```

3. **运行智能合约单元测试**（使用 Foundry）：
   ```bash
   cd contracts
   forge install
   forge test -vvv
   ```

### 6.2 未来升级 Roadmap

> [!NOTE]
> **1. 极致性能：向 Lambdaworks-math 全面迁移**
> 目前 Rust 端底层数学计算使用的是 Arkworks 库。如果将其全部重构成 LambdaClass 团队自主研发的高性能 **Lambdaworks** 密码学底层（特别是 bn254 曲线的域元素与群运算），将能获得在 x86_64 和 ARM64 芯片下的硬件加速，显著加快链下 Prover 速度。
>
> **2. 移动端优化：向 Plonky2 / Halo2 升级**
> 目前采用的 Groth16 需要针对每个电路进行单独的 Trusted Setup（可信设置），比较繁琐。未来可考虑将电路前端迁移到 Plonky2 / Halo2 等无需 Setup 且支持递归证明（Recursion Proof）的现代化证明系统中，使得在手机浏览器/移动端硬件下生成 ZK 证明成为可能。
>
> **3. 智能隐私 DeFi (Shielded AMM)**
> 引入 View Key (查看密钥) 的精细粒度管理。未来的隐私代币不仅可以实现转账隐私，还可以直接与链上的 Uniswap 等 AMM 交互——即通过将 Proof 发给特定的 Private Swap 合约，执行对外界完全不可见的匿名代币兑换，打开智能隐私 DeFi 的大门。
