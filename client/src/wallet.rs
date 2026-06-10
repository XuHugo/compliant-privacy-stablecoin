//! # Wallet 模块
//!
//! 管理用户的隐私 Note 和相关状态。

use compliant_privacy_stablecoin_circuits::merkle::MerkleTree;
use compliant_privacy_stablecoin_circuits::note::{random_field_element, Note, FE};
use std::collections::HashMap;

/// 钱包中存储的 Note 信息
#[derive(Debug, Clone)]
pub struct WalletNote {
    pub note: Note,
    pub leaf_index: usize,
    pub spent: bool,
}

/// 隐私钱包
#[derive(Debug)]
pub struct Wallet {
    /// 用户私钥 (用于派生 Note secret)
    secret_key: FE,
    /// 用户拥有的 Notes
    notes: HashMap<usize, WalletNote>,
    /// 本地 Merkle 树副本
    tree: MerkleTree,
}

impl Wallet {
    /// 创建新钱包
    pub fn new() -> Self {
        Self {
            secret_key: random_field_element(),
            notes: HashMap::new(),
            tree: MerkleTree::default_height(),
        }
    }

    /// 从已有私钥恢复钱包
    pub fn from_secret_key(secret_key: FE) -> Self {
        Self {
            secret_key,
            notes: HashMap::new(),
            tree: MerkleTree::default_height(),
        }
    }

    /// 获取钱包余额 (未花费 Notes 总额)
    pub fn balance(&self) -> u64 {
        self.notes
            .values()
            .filter(|n| !n.spent)
            .map(|n| n.note.amount)
            .sum()
    }

    /// 创建新的 Note 用于存款
    pub fn create_deposit_note(&mut self, amount: u64) -> (Note, FE) {
        let blinding = random_field_element();
        let note = Note::new(amount, self.secret_key.clone(), blinding);
        let commitment = note.commitment();
        (note, commitment)
    }

    /// 记录已确认的存款
    pub fn confirm_deposit(&mut self, note: Note, commitment: FE) {
        let leaf_index = self.tree.insert(commitment);
        self.notes.insert(
            leaf_index,
            WalletNote {
                note,
                leaf_index,
                spent: false,
            },
        );
    }

    /// 获取当前 Merkle 根
    pub fn merkle_root(&self) -> FE {
        self.tree.root()
    }

    /// 同步外部 commitment (其他人的存款)
    pub fn sync_external_commitment(&mut self, commitment: FE) {
        self.tree.insert(commitment);
    }

    /// 获取未花费的 Notes
    pub fn unspent_notes(&self) -> Vec<&WalletNote> {
        self.notes.values().filter(|n| !n.spent).collect()
    }

    /// 标记 Note 为已花费
    pub fn mark_spent(&mut self, leaf_index: usize) {
        if let Some(note) = self.notes.get_mut(&leaf_index) {
            note.spent = true;
        }
    }

    /// 获取指定 Note 的 Merkle 路径
    pub fn get_merkle_path(&self, leaf_index: usize) -> compliant_privacy_stablecoin_circuits::merkle::MerklePath {
        self.tree.get_path(leaf_index)
    }
}

impl Default for Wallet {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wallet_deposit_flow() {
        let mut wallet = Wallet::new();

        // 初始余额为 0
        assert_eq!(wallet.balance(), 0);

        // 创建存款 Note
        let (note, commitment) = wallet.create_deposit_note(1000);

        // 确认存款
        wallet.confirm_deposit(note, commitment);

        // 余额应该更新
        assert_eq!(wallet.balance(), 1000);
    }

    #[test]
    fn test_wallet_multiple_deposits() {
        let mut wallet = Wallet::new();

        for i in 1..=5 {
            let (note, commitment) = wallet.create_deposit_note(i * 100);
            wallet.confirm_deposit(note, commitment);
        }

        // 100 + 200 + 300 + 400 + 500 = 1500
        assert_eq!(wallet.balance(), 1500);
        assert_eq!(wallet.unspent_notes().len(), 5);
    }

    #[test]
    fn test_wallet_spend_note() {
        let mut wallet = Wallet::new();

        let (note, commitment) = wallet.create_deposit_note(1000);
        wallet.confirm_deposit(note, commitment);

        assert_eq!(wallet.balance(), 1000);

        // 标记为已花费
        wallet.mark_spent(0);

        assert_eq!(wallet.balance(), 0);
        assert_eq!(wallet.unspent_notes().len(), 0);
    }
}
