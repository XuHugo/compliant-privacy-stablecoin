# Privacy ERC20 (隐私 ERC20 协议)

基于 [Lambdaworks](https://github.com/lambdaclass/lambdaworks) 构建的隐私增强 ERC20 代币协议。

## 概述

本项目实现了一个类似 Tornado Cash / Zcash Sapling 的隐私转账机制：

- **隐藏金额**: 交易金额被加密，外部观察者无法得知
- **隐藏发送者/接收者**: 使用零知识证明验证交易有效性，无需暴露身份
- **防止双花**: 使用 Nullifier 机制确保每笔资金只能花费一次

## 项目结构

```
privacy-erc20/
├── circuits/           # ZK 电路定义 (Rust)
│   └── src/
│       ├── lib.rs
│       ├── note.rs     # Note 数据结构与承诺计算
│       └── merkle.rs   # Merkle 树工具
├── client/             # 客户端/钱包 (Rust)
│   └── src/
│       ├── lib.rs
│       └── wallet.rs   # 钱包管理
├── contracts/          # 智能合约 (Solidity)
│   └── src/
│       └── ShieldedPool.sol
└── README.md
```

## 核心概念

### Note (票据)

一个 Note 代表一笔加密的资金：

```
Note = {
    amount: u64,      // 金额
    secret: FE,       // 秘密值 (私钥派生)
    blinding: FE      // 盲化因子 (随机数)
}
```

### Commitment (承诺)

Note 的公开表示，存储在链上 Merkle 树中：

```
Commitment = Poseidon(amount, secret, blinding)
```

### Nullifier (无效符)

用于防止双花的唯一标识：

```
Nullifier = Poseidon(secret, leaf_index)
```

## 编译与测试

### 要求

- Rust nightly (lambdaworks 依赖)
- Foundry (智能合约)

### 编译 Rust 代码

```bash
cd privacy-erc20
cargo +nightly build
cargo +nightly test
```

### 编译智能合约

```bash
cd privacy-erc20/contracts
forge install
forge build
forge test
```

## 工作流程

1. **存款 (Deposit)**:
   - 用户在本地创建 Note
   - 计算 Commitment
   - 调用 `ShieldedPool.deposit(commitment, amount)`
   - Commitment 被添加到链上 Merkle 树

2. **转账 (Transfer)**:
   - 用户在本地生成 ZK 证明
   - 证明证明自己拥有某些 Notes，且金额守恒
   - 调用 `ShieldedPool.transact(proof, ...)`
   - 旧 Notes 的 Nullifiers 被标记为已用
   - 新 Commitments 被添加到树中

3. **提款 (Withdraw)**:
   - 与转账类似，但 `publicAmount` 为负数
   - 合约将代币转给指定接收地址

## 安全考虑

- ZK 证明确保交易有效性
- Nullifier 防止双花
- Merkle Tree 根历史验证防止恶意篡改
- 建议使用 Poseidon 哈希 (ZK 友好) 替代 Keccak256

## 许可证

Apache-2.0
