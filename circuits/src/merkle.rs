//! # Merkle 树模块
//!
//! 提供用于隐私 ERC20 的 Merkle 树工具，包括路径生成和根计算。
//! 使用 Arkworks BN254。

use crate::note::{fe_to_string, string_to_fe, FE};
use crate::poseidon::poseidon_hash_2;
use ark_ff::Field;
use ark_std::Zero;
use serde::{Deserialize, Serialize};
use std::str::FromStr;

/// Merkle 树的默认高度 (20 层 = 2^20 ≈ 100 万个叶子)
pub const DEFAULT_TREE_HEIGHT: usize = 20;

/// 预计算的零值 (用于空叶子)
/// ZERO_VALUES[i] = Hash(ZERO_VALUES[i-1], ZERO_VALUES[i-1])
fn compute_zero_values(height: usize) -> Vec<FE> {
    let mut zeros = Vec::with_capacity(height + 1);
    // 叶子层的零值
    zeros.push(FE::zero());

    for i in 1..=height {
        let prev = zeros[i - 1];
        // Hash(prev, prev) using Poseidon(2)
        zeros.push(poseidon_hash_2([prev, prev]));
    }
    zeros
}

/// Merkle 路径 (用于证明叶子存在于树中)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MerklePath {
    /// 从叶子到根的兄弟节点
    #[serde(serialize_with = "serialize_vec_fe", deserialize_with = "deserialize_vec_fe")]
    pub siblings: Vec<FE>,
    /// 路径索引 (0 = 左, 1 = 右)
    // Convert bool to int (0/1) for Circom
    #[serde(
        serialize_with = "serialize_bool_as_int",
        deserialize_with = "deserialize_int_as_bool"
    )]
    pub path_indices: Vec<bool>,
}

pub fn serialize_vec_fe<S>(vec: &Vec<FE>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    use serde::ser::SerializeSeq;
    let mut seq = serializer.serialize_seq(Some(vec.len()))?;
    for e in vec {
        seq.serialize_element(&e.to_string())?;
    }
    seq.end()
}

pub fn deserialize_vec_fe<'de, D>(deserializer: D) -> Result<Vec<FE>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s: Vec<String> = Vec::deserialize(deserializer)?;
    s.into_iter()
        .map(|s| FE::from_str(&s).map_err(|_| serde::de::Error::custom("FieldElement parse error")))
        .collect()
}

pub fn serialize_bool_as_int<S>(vec: &Vec<bool>, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    use serde::ser::SerializeSeq;
    let mut seq = serializer.serialize_seq(Some(vec.len()))?;
    for e in vec {
        seq.serialize_element(&(if *e { 1u8 } else { 0u8 }))?;
    }
    seq.end()
}

pub fn deserialize_int_as_bool<'de, D>(deserializer: D) -> Result<Vec<bool>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s: Vec<u8> = Vec::deserialize(deserializer)?;
    Ok(s.into_iter().map(|b| b == 1).collect())
}

impl MerklePath {
    /// 验证路径是否有效
    pub fn verify(&self, leaf: &FE, root: &FE) -> bool {
        let computed_root = self.compute_root(leaf);
        &computed_root == root
    }

    /// 从叶子计算根
    pub fn compute_root(&self, leaf: &FE) -> FE {
        let mut current = *leaf;

        for (sibling, is_right) in self.siblings.iter().zip(self.path_indices.iter()) {
            current = if *is_right {
                // 当前节点在右边: Hash(sibling, current)
                poseidon_hash_2([*sibling, current])
            } else {
                // 当前节点在左边: Hash(current, sibling)
                poseidon_hash_2([current, *sibling])
            };
        }

        current
    }
}

/// 简单的内存 Merkle 树实现 (用于测试和客户端)
#[derive(Debug, Clone)]
pub struct MerkleTree {
    /// 树的高度
    height: usize,
    /// 所有叶子 (从左到右)
    leaves: Vec<FE>,
    /// 预计算的零值
    zero_values: Vec<FE>,
}

impl MerkleTree {
    /// 创建指定高度的空 Merkle 树
    pub fn new(height: usize) -> Self {
        Self {
            height,
            leaves: Vec::new(),
            zero_values: compute_zero_values(height),
        }
    }

    /// 创建默认高度的 Merkle 树
    pub fn default_height() -> Self {
        Self::new(DEFAULT_TREE_HEIGHT)
    }

    /// 插入新叶子，返回叶子索引
    pub fn insert(&mut self, leaf: FE) -> usize {
        let index = self.leaves.len();
        if index >= (1 << self.height) {
            panic!("Merkle tree is full");
        }
        self.leaves.push(leaf);
        index
    }

    /// 获取当前根哈希
    pub fn root(&self) -> FE {
        self.compute_root_at_level(0, 0, self.height)
    }

    /// 递归计算指定子树的根
    fn compute_root_at_level(&self, start_index: usize, level: usize, remaining_height: usize) -> FE {
        if remaining_height == 0 {
            // 叶子层
            if start_index < self.leaves.len() {
                self.leaves[start_index]
            } else {
                self.zero_values[0]
            }
        } else {
            let left_child = self.compute_root_at_level(
                start_index * 2,
                level + 1,
                remaining_height - 1,
            );
            let right_child = self.compute_root_at_level(
                start_index * 2 + 1,
                level + 1,
                remaining_height - 1,
            );
            poseidon_hash_2([left_child, right_child])
        }
    }

    /// 生成指定叶子的 Merkle 路径
    pub fn get_path(&self, leaf_index: usize) -> MerklePath {
        let mut siblings = Vec::with_capacity(self.height);
        let mut path_indices = Vec::with_capacity(self.height);
        let mut current_index = leaf_index;

        for level in 0..self.height {
            let is_right = current_index % 2 == 1;
            path_indices.push(is_right);

            let sibling_index = if is_right {
                current_index - 1
            } else {
                current_index + 1
            };

            let sibling = self.get_node_at_level(sibling_index, level);
            siblings.push(sibling);

            current_index /= 2;
        }

        MerklePath {
            siblings,
            path_indices,
        }
    }

    /// 获取指定层级的节点值
    fn get_node_at_level(&self, index: usize, level: usize) -> FE {
        if level == 0 {
            // 叶子层
            if index < self.leaves.len() {
                self.leaves[index]
            } else {
                self.zero_values[0]
            }
        } else {
            let left_child = self.get_node_at_level(index * 2, level - 1);
            let right_child = self.get_node_at_level(index * 2 + 1, level - 1);
            poseidon_hash_2([left_child, right_child])
        }
    }

    /// 获取叶子数量
    pub fn len(&self) -> usize {
        self.leaves.len()
    }

    /// 树是否为空
    pub fn is_empty(&self) -> bool {
        self.leaves.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::note::random_field_element;

    #[test]
    fn test_empty_tree_root() {
        let tree = MerkleTree::new(4);
        let root = tree.root();
        // 空树的根应该是确定性的
        let tree2 = MerkleTree::new(4);
        assert_eq!(root, tree2.root());
    }

    #[test]
    fn test_insert_and_verify_path() {
        let mut tree = MerkleTree::new(4);

        let leaf = random_field_element();
        let index = tree.insert(leaf);
        assert_eq!(index, 0);

        let root = tree.root();
        let path = tree.get_path(0);

        // 验证路径
        assert!(path.verify(&leaf, &root));
    }
}
