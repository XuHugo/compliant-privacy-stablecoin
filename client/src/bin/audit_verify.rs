use serde::Deserialize;
use std::fs::File;
use std::io::Read;
use compliant_privacy_stablecoin_client::audit::{PrivateKeyShare, EncryptedAuditKey};
use ark_bn254::Fr;
use ark_serialize::{CanonicalSerialize, CanonicalDeserialize};

#[derive(Deserialize, Debug)]
struct BroadcastLog {
    data: String,
}

#[derive(Deserialize, Debug)]
struct BroadcastReceipt {
    logs: Vec<BroadcastLog>,
}

#[derive(Deserialize, Debug)]
struct BroadcastFile {
    receipts: Vec<BroadcastReceipt>,
}

#[derive(Deserialize, Debug)]
struct NodeDkgData {
    node_id: usize,
    aggregated_private_share: String,
}

#[derive(Deserialize, Debug)]
struct DkgTestData {
    nodes: Vec<NodeDkgData>,
    sample_sym_key: String,
    sample_ciphertext: String,
}

fn main() {
    println!("=== 启动链上审计交互与解密验证 ===");

    println!("-> 当前工作目录: {:?}", std::env::current_dir().unwrap());

    // 1. 读取 DKG 密钥与样本数据
    let dkg_path = "contracts/test/dkg_test_data.json";
    let mut dkg_file = File::open(dkg_path)
        .unwrap_or_else(|e| panic!("无法打开 {} : {:?}", dkg_path, e));
    let mut dkg_content = String::new();
    dkg_file.read_to_string(&mut dkg_content).unwrap();
    let dkg_data: DkgTestData = serde_json::from_str(&dkg_content).unwrap();
    println!("-> 成功读取 DKG 密钥包，获取审计人私钥碎片。");

    // 2. 读取 Anvil 广播交易日志文件
    let broadcast_path = "contracts/broadcast/TestAuditLive.s.sol/31337/run-latest.json";
    let mut broadcast_file = File::open(broadcast_path)
        .unwrap_or_else(|e| panic!("无法打开广播日志 {} : {:?}", broadcast_path, e));
    let mut broadcast_content = String::new();
    broadcast_file.read_to_string(&mut broadcast_content).unwrap();
    let broadcast: BroadcastFile = serde_json::from_str(&broadcast_content).unwrap();
    println!("-> 成功读取 Anvil 链上交易日志（{}）", broadcast_path);

    // 3. 从交易日志中定位 Transact 事件并提取加密的审计密文 (C_key)
    let target_hex = &dkg_data.sample_ciphertext;
    let mut found_ciphertext_hex: Option<String> = None;

    for receipt in &broadcast.receipts {
        for log in &receipt.logs {
            if log.data.contains(target_hex) {
                found_ciphertext_hex = Some(target_hex.clone());
                break;
            }
        }
        if found_ciphertext_hex.is_some() {
            break;
        }
    }

    let ciphertext_hex = found_ciphertext_hex.expect("在 Anvil 交易日志中未找到包含对应密文的 Transact 事件");
    println!("-> 从 Anvil 交易收据日志（Event Log）中成功截获加密审计密文！");
    println!("   密文 (Hex): {}", ciphertext_hex);

    // 4. 反序列化加密密钥 (C_key = {ephemeral_public, masked_key})
    let ciphertext_bytes = hex::decode(&ciphertext_hex).unwrap();
    let ciphertext = EncryptedAuditKey::from_bytes(&ciphertext_bytes)
        .expect("反序列化密文失败，请检查数据格式");

    // 5. 模拟审计机关联合 3 个审计人节点（例如节点 1, 3, 5）生成解密份额
    println!("-> 模拟 3 个审计节点（Node 1, Node 3, Node 5）联合进行门限解密：");
    let mut decryption_shares = Vec::new();
    
    // 我们选择节点 1, 3, 5 (索引 0, 2, 4)
    let selected_indices = vec![0, 2, 4];
    for idx in selected_indices {
        let node = &dkg_data.nodes[idx];
        let sk_share_bytes = hex::decode(&node.aggregated_private_share).unwrap();
        let sk_share_fr = Fr::deserialize_compressed(&mut &sk_share_bytes[..]).unwrap();
        
        let priv_key_share = PrivateKeyShare {
            node_id: node.node_id,
            share: sk_share_fr,
        };

        // 计算该节点的解密份额 (D_j = sk_j * R)
        let dec_share = ciphertext.decrypt_share(&priv_key_share);
        decryption_shares.push(dec_share);
        println!("   [节点 {}] 生成局部解密份额成功", node.node_id);
    }

    // 6. 门限解密还原对称密钥
    let decrypted_sym_key_fr = ciphertext.decrypt(&decryption_shares)
        .expect("3-of-5 联合解密失败");
    
    let mut decrypted_bytes = Vec::new();
    decrypted_sym_key_fr.serialize_compressed(&mut decrypted_bytes).unwrap();
    let decrypted_sym_key_hex = hex::encode(decrypted_bytes);

    println!("-> 联合门限解密完成！");
    println!("   解密出的对称密钥 (Hex): {}", decrypted_sym_key_hex);
    println!("   期望的对称密钥   (Hex): {}", dkg_data.sample_sym_key);

    // 7. 校验解密结果
    assert_eq!(decrypted_sym_key_hex, dkg_data.sample_sym_key, "解密出的对称密钥与期望不符！审计失败。");
    println!("=== 🟢 审计解密验证成功！已证明可通过链上提取的交易数据联合还原审计密钥。 ===");
}
