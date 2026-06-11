use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use ark_bn254::{Fr, G1Projective};
use ark_serialize::{CanonicalSerialize, CanonicalDeserialize};
use ark_ec::CurveGroup;
use compliant_privacy_stablecoin_client::audit::{DkgPolynomial, PrivateKeyShare, AuditPublicKey, EncryptedAuditKey, DecryptionShare};

#[derive(Serialize, Deserialize)]
pub struct WasmNodeDkgResult {
    pub node_id: usize,
    pub communication_key: String,
    pub communication_secret: String,
    pub commitments: Vec<String>,
    pub shares: Vec<String>,
}

#[derive(Deserialize)]
pub struct WasmDecryptionShareInput {
    pub node_id: usize,
    pub share_point_hex: String,
}

// Ensure error panic hook runs once
#[wasm_bindgen(start)]
pub fn start() {
    std::panic::set_hook(Box::new(console_error_panic_hook::hook));
}

/// 阶段 1: 审计节点本地确定性生成 DKG 多项式、承诺与通信密钥对
#[wasm_bindgen]
pub fn wasm_generate_dkg_keys(node_id: usize, seed_hex: String) -> Result<JsValue, JsValue> {
    let seed_bytes = hex::decode(&seed_hex)
        .map_err(|e| JsValue::from_str(&format!("Seed Hex 解码失败: {}", e)))?;
    
    if seed_bytes.len() != 32 {
        return Err(JsValue::from_str("Seed 长度必须为 32 字节"));
    }

    use sha2::{Sha256, Digest};
    use ark_ff::PrimeField;
    use ark_ec::Group;

    // 1. 确定性派生 DKG 多项式系数 (阈值 3)
    let mut coefficients = Vec::with_capacity(3);
    for i in 0..3 {
        let mut hasher = Sha256::new();
        hasher.update(&seed_bytes);
        hasher.update(format!("coeff_{}", i).as_bytes());
        let hash_result = hasher.finalize();
        let coeff = Fr::from_le_bytes_mod_order(&hash_result);
        coefficients.push(coeff);
    }
    let poly = DkgPolynomial {
        node_id,
        coefficients,
    };

    // 2. 本地计算 G1 承诺
    let comms = poly.commitments();
    let commitments: Vec<String> = comms
        .iter()
        .map(|p| {
            let mut bytes = Vec::new();
            p.serialize_compressed(&mut bytes).unwrap();
            hex::encode(bytes)
        })
        .collect();

    // 3. 计算分发给各审计节点的 Shares 评估值 (x = 1..=5)
    let mut shares = Vec::new();
    for j in 1..=5 {
        let x = Fr::from(j as u64);
        let eval_val = poly.evaluate(x);
        let mut val_bytes = Vec::new();
        eval_val.serialize_compressed(&mut val_bytes).unwrap();
        shares.push(hex::encode(val_bytes));
    }

    // 4. 确定性派生通信公私钥
    let mut hasher = Sha256::new();
    hasher.update(&seed_bytes);
    hasher.update(b"comm_secret");
    let hash_result = hasher.finalize();
    let comm_secret = Fr::from_le_bytes_mod_order(&hash_result);
    
    let g = G1Projective::generator();
    let comm_public = g * comm_secret;

    let mut secret_bytes = Vec::new();
    comm_secret.serialize_compressed(&mut secret_bytes).unwrap();
    let comm_secret_hex = hex::encode(secret_bytes);

    let mut public_bytes = Vec::new();
    comm_public.serialize_compressed(&mut public_bytes).unwrap();
    let comm_public_hex = hex::encode(public_bytes);

    let res = WasmNodeDkgResult {
        node_id,
        communication_key: comm_public_hex,
        communication_secret: comm_secret_hex,
        commitments,
        shares,
    };

    Ok(serde_wasm_bindgen::to_value(&res).unwrap())
}

/// 聚合各个节点的承诺首项 A_i,0 生成全局公钥
#[wasm_bindgen]
pub fn wasm_aggregate_global_public_key(commitments_json: String) -> Result<String, JsValue> {
    let a0_hexes: Vec<String> = serde_json::from_str(&commitments_json)
        .map_err(|e| JsValue::from_str(&format!("JSON 解析失败: {}", e)))?;

    if a0_hexes.len() != 5 {
        return Err(JsValue::from_str("需要 5 个节点的承诺首项进行聚合"));
    }

    let mut a0_points = Vec::new();
    for hex_str in a0_hexes {
        let bytes = hex::decode(&hex_str)
            .map_err(|e| JsValue::from_str(&format!("Hex 解码失败: {}", e)))?;
        let point = G1Projective::deserialize_compressed(&mut &bytes[..])
            .map_err(|e| JsValue::from_str(&format!("承诺点反序列化失败: {}", e)))?;
        a0_points.push(point);
    }

    let global_pk = AuditPublicKey::aggregate(&a0_points);
    let mut pk_bytes = Vec::new();
    global_pk.point.serialize_compressed(&mut pk_bytes).unwrap();
    Ok(hex::encode(pk_bytes))
}

/// 阶段 2: 审计节点解密自己收到的 5 个 DKG 评估碎片，聚合生成其本地最终的私钥碎片 sk_j
#[wasm_bindgen]
pub fn wasm_aggregate_shares(shares_json: String, node_id: usize) -> Result<String, JsValue> {
    // shares_json 应该是个 Vec<String> 的 JSON 序列化，包含从其他节点收到的 5 个 share 评估值
    let share_hexes: Vec<String> = serde_json::from_str(&shares_json)
        .map_err(|e| JsValue::from_str(&format!("JSON 解析失败: {}", e)))?;

    if share_hexes.len() != 5 {
        return Err(JsValue::from_str("需要恰好 5 个多项式评估 Share 进行聚合"));
    }

    let mut shares_fr = Vec::new();
    for hex_str in share_hexes {
        let bytes = hex::decode(&hex_str)
            .map_err(|e| JsValue::from_str(&format!("Hex 解码失败: {}", e)))?;
        let val = Fr::deserialize_compressed(&mut &bytes[..])
            .map_err(|e| JsValue::from_str(&format!("Share 反序列化失败: {}", e)))?;
        shares_fr.push(val);
    }

    // 聚合评估值生成最终的私钥碎片
    let sk_share = PrivateKeyShare::aggregate(&shares_fr, node_id);
    
    let mut sk_bytes = Vec::new();
    sk_share.share.serialize_compressed(&mut sk_bytes).unwrap();
    Ok(hex::encode(sk_bytes))
}

/// 阶段 3: 用户对对称密钥进行加密 (C_key)
#[wasm_bindgen]
pub fn wasm_encrypt_audit_key(global_pub_key_hex: String, sym_key_hex: String) -> Result<String, JsValue> {
    let pub_key_bytes = hex::decode(&global_pub_key_hex)
        .map_err(|e| JsValue::from_str(&format!("Hex 解码失败: {}", e)))?;
    let pub_key = AuditPublicKey::from_bytes(&pub_key_bytes)
        .map_err(|e| JsValue::from_str(&format!("公钥反序列化失败: {}", e)))?;

    let sym_key_bytes = hex::decode(&sym_key_hex)
        .map_err(|e| JsValue::from_str(&format!("Hex 解码失败: {}", e)))?;
    let sym_key = Fr::deserialize_compressed(&mut &sym_key_bytes[..])
        .map_err(|e| JsValue::from_str(&format!("对称密钥反序列化失败: {}", e)))?;

    let ciphertext = EncryptedAuditKey::encrypt(&pub_key, sym_key);
    Ok(hex::encode(ciphertext.to_bytes()))
}

/// 阶段 4: 审计节点使用自己的私钥碎片对交易密文计算局部解密点
#[wasm_bindgen]
pub fn wasm_decrypt_share(ciphertext_hex: String, sk_share_hex: String, node_id: usize) -> Result<String, JsValue> {
    let cipher_bytes = hex::decode(&ciphertext_hex)
        .map_err(|e| JsValue::from_str(&format!("Hex 解码失败: {}", e)))?;
    let ciphertext = EncryptedAuditKey::from_bytes(&cipher_bytes)
        .map_err(|e| JsValue::from_str(&format!("密文反序列化失败: {}", e)))?;

    let sk_bytes = hex::decode(&sk_share_hex)
        .map_err(|e| JsValue::from_str(&format!("Hex 解码失败: {}", e)))?;
    let sk_fr = Fr::deserialize_compressed(&mut &sk_bytes[..])
        .map_err(|e| JsValue::from_str(&format!("私钥碎片反序列化失败: {}", e)))?;

    let priv_share = PrivateKeyShare {
        node_id,
        share: sk_fr,
    };

    let dec_share = ciphertext.decrypt_share(&priv_share);
    
    let mut share_bytes = Vec::new();
    dec_share.share_point.serialize_compressed(&mut share_bytes).unwrap();
    Ok(hex::encode(share_bytes))
}

/// 阶段 5: 审计机构汇总 3/5 个局部解密份额还原明秘钥
#[wasm_bindgen]
pub fn wasm_threshold_decrypt(ciphertext_hex: String, shares_json: String) -> Result<String, JsValue> {
    let cipher_bytes = hex::decode(&ciphertext_hex)
        .map_err(|e| JsValue::from_str(&format!("Hex 解码失败: {}", e)))?;
    let ciphertext = EncryptedAuditKey::from_bytes(&cipher_bytes)
        .map_err(|e| JsValue::from_str(&format!("密文反序列化失败: {}", e)))?;

    // shares_json 应该是个 Vec<WasmDecryptionShareInput> 的 JSON 序列化
    let inputs: Vec<WasmDecryptionShareInput> = serde_json::from_str(&shares_json)
        .map_err(|e| JsValue::from_str(&format!("JSON 解析失败: {}", e)))?;

    if inputs.len() < 3 {
        return Err(JsValue::from_str("需要至少 3 个节点的解密份额方可进行门限解密"));
    }

    let mut shares = Vec::new();
    for input in inputs {
        let pt_bytes = hex::decode(&input.share_point_hex)
            .map_err(|e| JsValue::from_str(&format!("Hex 解码失败: {}", e)))?;
        let point = G1Projective::deserialize_compressed(&mut &pt_bytes[..])
            .map_err(|e| JsValue::from_str(&format!("解密碎片点反序列化失败: {}", e)))?;
        
        shares.push(DecryptionShare {
            node_id: input.node_id,
            share_point: point,
        });
    }

    let sym_key = ciphertext.decrypt(&shares)
        .map_err(|e| JsValue::from_str(&format!("门限解密失败: {}", e)))?;

    let mut sym_bytes = Vec::new();
    sym_key.serialize_compressed(&mut sym_bytes).unwrap();
    Ok(hex::encode(sym_bytes))
}

/// 使用接收方的通信公钥，加密本地计算出的 DKG 评估碎片
#[wasm_bindgen]
pub fn wasm_encrypt_dkg_share(share_hex: String, recipient_pubkey_hex: String) -> Result<String, JsValue> {
    use rand::rngs::OsRng;
    use ark_ff::UniformRand;
    use ark_ec::Group;
    use sha2::{Sha256, Digest};
    use ark_ff::PrimeField;

    let share_bytes = hex::decode(&share_hex)
        .map_err(|e| JsValue::from_str(&format!("Share Hex 解码失败: {}", e)))?;
    let share_fr = Fr::deserialize_compressed(&mut &share_bytes[..])
        .map_err(|e| JsValue::from_str(&format!("Share 反序列化失败: {}", e)))?;

    let pubkey_bytes = hex::decode(&recipient_pubkey_hex)
        .map_err(|e| JsValue::from_str(&format!("公钥 Hex 解码失败: {}", e)))?;
    let pubkey_point = G1Projective::deserialize_compressed(&mut &pubkey_bytes[..])
        .map_err(|e| JsValue::from_str(&format!("公钥点反序列化失败: {}", e)))?;

    let mut rng = OsRng;
    let r = Fr::rand(&mut rng);
    let g = G1Projective::generator();
    
    // C_1 = r * G
    let c1 = g * r;
    
    // S = r * PK_comm
    let shared_secret = pubkey_point * r;
    
    // blinding_factor = Hash(S)
    let affine = shared_secret.into_affine();
    let mut x_bytes = Vec::new();
    affine.x.serialize_compressed(&mut x_bytes).unwrap();
    let mut hasher = Sha256::new();
    hasher.update(&x_bytes);
    let hash_result = hasher.finalize();
    let k = Fr::from_le_bytes_mod_order(&hash_result);

    // C_2 = s + k
    let c2 = share_fr + k;

    // Serialize C_1 and C_2
    let mut c1_bytes = Vec::new();
    c1.serialize_compressed(&mut c1_bytes).unwrap();
    let mut c2_bytes = Vec::new();
    c2.serialize_compressed(&mut c2_bytes).unwrap();

    let mut ciphertext_bytes = Vec::new();
    ciphertext_bytes.extend_from_slice(&c1_bytes);
    ciphertext_bytes.extend_from_slice(&c2_bytes);

    Ok(hex::encode(ciphertext_bytes))
}

/// 使用我自己的通信私钥，解密收到的加密 DKG 评估碎片
#[wasm_bindgen]
pub fn wasm_decrypt_dkg_share(encrypted_share_hex: String, my_comm_secret_hex: String) -> Result<String, JsValue> {
    use sha2::{Sha256, Digest};
    use ark_ff::PrimeField;
    use ark_ec::CurveGroup;

    let cipher_bytes = hex::decode(&encrypted_share_hex)
        .map_err(|e| JsValue::from_str(&format!("密文 Hex 解码失败: {}", e)))?;
    if cipher_bytes.len() != 64 {
        return Err(JsValue::from_str("密文长度应为 64 字节"));
    }

    let c1_bytes = &cipher_bytes[0..32];
    let c2_bytes = &cipher_bytes[32..64];

    let c1 = G1Projective::deserialize_compressed(&mut &c1_bytes[..])
        .map_err(|e| JsValue::from_str(&format!("密文 C1 反序列化失败: {}", e)))?;
    let c2 = Fr::deserialize_compressed(&mut &c2_bytes[..])
        .map_err(|e| JsValue::from_str(&format!("密文 C2 反序列化失败: {}", e)))?;

    let secret_bytes = hex::decode(&my_comm_secret_hex)
        .map_err(|e| JsValue::from_str(&format!("私钥 Hex 解码失败: {}", e)))?;
    let sk = Fr::deserialize_compressed(&mut &secret_bytes[..])
        .map_err(|e| JsValue::from_str(&format!("私钥反序列化失败: {}", e)))?;

    // S = sk * C_1
    let shared_secret = c1 * sk;

    // blinding_factor = Hash(S)
    let affine = shared_secret.into_affine();
    let mut x_bytes = Vec::new();
    affine.x.serialize_compressed(&mut x_bytes).unwrap();
    let mut hasher = Sha256::new();
    hasher.update(&x_bytes);
    let hash_result = hasher.finalize();
    let k = Fr::from_le_bytes_mod_order(&hash_result);

    // s = C_2 - k
    let share_fr = c2 - k;

    let mut share_bytes = Vec::new();
    share_fr.serialize_compressed(&mut share_bytes).unwrap();

    Ok(hex::encode(share_bytes))
}

/// 计算 Note 承诺 (Commitment)
#[wasm_bindgen]
pub fn wasm_create_note_commitment(amount: u64, secret_hex: String, blinding_hex: String) -> Result<String, JsValue> {
    use compliant_privacy_stablecoin_circuits::note::Note;
    let secret_bytes = hex::decode(&secret_hex)
        .map_err(|e| JsValue::from_str(&format!("Secret Hex 解码失败: {}", e)))?;
    let secret = Fr::deserialize_compressed(&mut &secret_bytes[..])
        .map_err(|e| JsValue::from_str(&format!("Secret 反序列化失败: {}", e)))?;
    
    let blinding_bytes = hex::decode(&blinding_hex)
        .map_err(|e| JsValue::from_str(&format!("Blinding Hex 解码失败: {}", e)))?;
    let blinding = Fr::deserialize_compressed(&mut &blinding_bytes[..])
        .map_err(|e| JsValue::from_str(&format!("Blinding 反序列化失败: {}", e)))?;

    let note = Note::new(amount, secret, blinding);
    let commitment = note.commitment();
    
    let mut comm_bytes = Vec::new();
    commitment.serialize_compressed(&mut comm_bytes).unwrap();
    Ok(hex::encode(comm_bytes))
}

/// 计算 Note Nullifier
#[wasm_bindgen]
pub fn wasm_create_note_nullifier(secret_hex: String, leaf_index: u64) -> Result<String, JsValue> {
    use compliant_privacy_stablecoin_circuits::note::Note;
    let secret_bytes = hex::decode(&secret_hex)
        .map_err(|e| JsValue::from_str(&format!("Secret Hex 解码失败: {}", e)))?;
    let secret = Fr::deserialize_compressed(&mut &secret_bytes[..])
        .map_err(|e| JsValue::from_str(&format!("Secret 反序列化失败: {}", e)))?;

    let note = Note::new(0, secret, Fr::from(0));
    let nullifier = note.nullifier(leaf_index);

    let mut null_bytes = Vec::new();
    nullifier.serialize_compressed(&mut null_bytes).unwrap();
    Ok(hex::encode(null_bytes))
}
