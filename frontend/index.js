// Import the WASM module
import init, {
    wasm_generate_dkg_keys,
    wasm_aggregate_global_public_key,
    wasm_aggregate_shares,
    wasm_encrypt_audit_key,
    wasm_decrypt_share,
    wasm_threshold_decrypt,
    wasm_encrypt_dkg_share,
    wasm_decrypt_dkg_share,
    wasm_create_note_commitment,
    wasm_create_note_nullifier
} from './pkg/compliant_privacy_stablecoin_wasm.js?v=3';

// Configuration
// Deployed Anvil Contract addresses
const DEFAULT_REGISTRY_ADDRESS = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";
const MOCK_TOKEN_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const SHIELDED_POOL_ADDRESS = "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9";

// Standard Anvil Key 0 (Deployer key) to simulate the faucet transfers
const ANVIL_FAUCET_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const AUDITORS = [
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // Auditor 1
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // Auditor 2
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906", // Auditor 3
    "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", // Auditor 4
    "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc"  // Auditor 5
];

const REGISTRY_ABI = [
    "function auditors(uint256) view returns (address)",
    "function isAuditor(address) view returns (bool)",
    "function communicationPublicKeys(address) view returns (bytes)",
    "function dkgCommitments(address, uint256) view returns (bytes)",
    "function encryptedShares(address, address) view returns (bytes)",
    "function globalAuditPublicKey() view returns (bytes)",
    "function isDkgCompleted() view returns (bool)",
    "function registerCommunicationKey(bytes) external",
    "function submitDkgData(bytes[3], address[5], bytes[5]) external",
    "function finalizeGlobalPublicKey(bytes) external"
];

const TOKEN_ABI = [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address, uint256) returns (bool)",
    "function transfer(address, uint256) returns (bool)"
];

const SHIELDED_POOL_ABI = [
    "function deposit(bytes32 commitment, uint256 amount) external",
    "function transact(bytes proof, bytes32 root, bytes32 cleanTreeRoot, bytes32 nullifier1, bytes32 nullifier2, bytes32 commitment1, bytes32 commitment2, int256 publicAmount, address recipient, address relayer, uint256 relayerFee, bytes encryptedAuditData, uint256[4] auditCiphertext) external",
    "function getRoot() view returns (bytes32)",
    "function isSpent(bytes32 nullifier) view returns (bool)",
    "function nextLeafIndex() view returns (uint256)",
    "function leaves(uint256) view returns (bytes32)",
    "event Deposit(bytes32 indexed commitment, uint256 leafIndex, uint256 timestamp)",
    "event Transact(bytes32 indexed nullifier1, bytes32 indexed nullifier2, bytes32 commitment1, bytes32 commitment2, bytes encryptedAuditData, uint256[4] auditCiphertext)"
];

// App State
let provider;
let signer;
let contract;
let currentAddress = "";
let currentAuditorIndex = -1; // 0 to 4, or -1 if not auditor
let myDkgResult = null; // Stores generated polynomial, commitments, shares
let collectedDecryptionShares = []; // [{ node_id, share_point_hex }]
let myDkgSeed = ""; // Derived in-memory DKG seed
let myCommSecretHex = ""; // Derived in-memory communication private key
let myCommPublicHex = ""; // Derived in-memory communication public key
let mySkShareHex = ""; // Derived in-memory DKG private key share (sk_j)

// Initialize WASM and UI
window.addEventListener('load', async () => {
    try {
        await init();
        console.log("WASM Initialized successfully.");
        showToast("WASM 密码学模块加载成功", "success");
        setupUI();

        // Listen for MetaMask account and network changes once
        if (window.ethereum) {
            window.ethereum.on('accountsChanged', (newAccounts) => {
                if (newAccounts.length === 0) {
                    location.reload();
                } else {
                    connectWallet();
                }
            });
            window.ethereum.on('chainChanged', () => {
                location.reload();
            });
        }
    } catch (err) {
        console.error("WASM init failed:", err);
        showToast("WASM 模块初始化失败，请检查浏览器控制台", "error");
    }
});

// Toast Notifications Helper
function showToast(message, type = "info") {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = "fa-circle-info";
    if (type === "success") icon = "fa-circle-check";
    if (type === "error") icon = "fa-triangle-exclamation";

    toast.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = "toast-in 0.3s ease reverse forwards";
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// Show/Hide Loading Overlay
function showLoading(text) {
    const modal = document.getElementById('loading-modal');
    document.getElementById('loading-text').innerText = text;
    modal.classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-modal').classList.add('hidden');
}

// Setup Event Listeners and Tabs
function setupUI() {
    // Wallet Connect
    document.getElementById('btn-connect-wallet').addEventListener('click', connectWallet);

    // DKG Steps
    document.getElementById('btn-step1-generate').addEventListener('click', generateLocalKeys);
    document.getElementById('btn-step1-register').addEventListener('click', registerCommKey);
    document.getElementById('btn-step2-submit').addEventListener('click', submitDkgData);
    document.getElementById('btn-step3-aggregate').addEventListener('click', aggregateMyShares);
    document.getElementById('btn-step4-finalize').addEventListener('click', finalizeGlobalKey);

    // Audit Panel
    document.getElementById('btn-gen-sym-key').addEventListener('click', generateRandomSymKey);
    document.getElementById('btn-encrypt-key').addEventListener('click', encryptSymKey);
    document.getElementById('btn-gen-my-share').addEventListener('click', computeDecryptionShare);
    document.getElementById('btn-aggregate-decryption').addEventListener('click', aggregateDecryption);
    document.getElementById('btn-copy-cipher').addEventListener('click', () => {
        const cipherText = document.getElementById('txt-ciphertext-out').value;
        navigator.clipboard.writeText(cipherText);
        showToast("密文已复制到剪贴板", "success");
    });

    // Manual decryption share import
    document.getElementById('btn-toggle-manual-import').addEventListener('click', () => {
        document.getElementById('manual-import-row').classList.toggle('hidden');
    });
    document.getElementById('btn-submit-imported-share').addEventListener('click', importManualShare);

    // Disconnect wallet
    document.getElementById('btn-disconnect').addEventListener('click', disconnectWallet);

    // Tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const target = btn.dataset.tab;
            document.querySelectorAll('.tab-content').forEach(content => {
                if (content.id === target) {
                    content.classList.remove('hidden');
                } else {
                    content.classList.add('hidden');
                }
            });
        });
    });

    // SPA View Switcher
    const navBtns = document.querySelectorAll('.nav-btn');
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const targetView = btn.dataset.view;
            document.querySelectorAll('.view-content').forEach(view => {
                if (view.id === targetView) {
                    view.classList.remove('hidden');
                } else {
                    view.classList.add('hidden');
                }
            });
            // Auto refresh states on view switch
            if (targetView === 'view-wallet') {
                refreshWalletState();
            } else if (targetView === 'view-audit') {
                refreshAuditTxs();
            }
        });
    });

    // Wallet Tab Switcher
    const walletTabBtns = document.querySelectorAll('.wallet-tab-btn');
    walletTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            walletTabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const targetTab = btn.dataset.wtab;
            document.querySelectorAll('.wallet-tab-content').forEach(content => {
                if (content.id === targetTab) {
                    content.classList.remove('hidden');
                } else {
                    content.classList.add('hidden');
                }
            });
        });
    });

    // Wallet Action Listeners
    document.getElementById('btn-wallet-approve').addEventListener('click', walletApprove);
    document.getElementById('btn-wallet-deposit').addEventListener('click', walletDeposit);
    document.getElementById('btn-wallet-transfer').addEventListener('click', walletTransfer);
    document.getElementById('btn-wallet-withdraw').addEventListener('click', walletWithdraw);
    document.getElementById('btn-wallet-mint').addEventListener('click', walletMint);
    document.getElementById('btn-wallet-refresh').addEventListener('click', refreshWalletState);
    document.getElementById('btn-copy-privacy-address').addEventListener('click', () => {
        const addr = document.getElementById('txt-my-privacy-address').value;
        if (addr && addr !== "连接钱包并签名后生成...") {
            navigator.clipboard.writeText(addr);
            showToast("隐私收款地址已复制！", "success");
        }
    });

    // Auditor Tab / Compliance Console Action Listeners
    document.getElementById('btn-audit-gen-share').addEventListener('click', auditComputeShare);
    document.getElementById('btn-audit-decrypt').addEventListener('click', auditDecryptAndVerify);
}

function disconnectWallet() {
    provider = null;
    signer = null;
    contract = null;
    currentAddress = "";
    currentAuditorIndex = -1;
    myDkgResult = null;
    myDkgSeed = "";
    myCommSecretHex = "";
    myCommPublicHex = "";
    mySkShareHex = "";
    
    document.getElementById('wallet-info').classList.add('hidden');
    document.getElementById('btn-connect-wallet').classList.remove('hidden');
    
    // Clear outputs
    const output1 = document.getElementById('step1-output');
    output1.classList.add('hidden');
    output1.innerText = '';
    const output2 = document.getElementById('step2-output');
    output2.classList.add('hidden');
    output2.innerText = '';
    
    document.getElementById('step3-output').classList.add('hidden');
    document.getElementById('step4-output').classList.add('hidden');
    document.getElementById('btn-step1-register').disabled = true;
    document.getElementById('select-node-id').disabled = false;
    
    // Reset recipient key UI
    const addrInput = document.getElementById('txt-my-privacy-address');
    if (addrInput) {
        addrInput.value = "";
    }

    showToast("已断开当前钱包连接，请重新连接或切换账户", "info");
}

// MetaMask Connection
async function connectWallet() {
    if (!window.ethereum) {
        showToast("请先安装 MetaMask 钱包！", "error");
        return;
    }

    showLoading("正在连接 MetaMask 钱包...");
    try {
        provider = new window.ethers.BrowserProvider(window.ethereum);
        const accounts = await provider.send("eth_requestAccounts", []);
        signer = await provider.getSigner();
        
        // Ensure network is Anvil (Chain ID 31337)
        const network = await provider.getNetwork();
        const chainId = network.chainId;
        if (chainId !== 31337n) {
            showToast("请切换网络至 Localhost 8545 (Chain ID 31337)！", "warning");
            try {
                await window.ethereum.request({
                    method: 'wallet_switchEthereumChain',
                    params: [{ chainId: '0x7a69' }], // 31337 in hex
                });
            } catch (switchError) {
                if (switchError.code === 4902) {
                    try {
                        await window.ethereum.request({
                            method: 'wallet_addEthereumChain',
                            params: [{
                                chainId: '0x7a69',
                                chainName: 'Anvil Localhost',
                                rpcUrls: ['http://127.0.0.1:8545'],
                                nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }
                            }],
                        });
                    } catch (addError) {
                        console.error("添加本地链失败:", addError);
                    }
                }
            }
            // Re-instantiate after network switch
            provider = new window.ethers.BrowserProvider(window.ethereum);
            signer = await provider.getSigner();
        }

        currentAddress = accounts[0];

        // Reset local DKG key-gen state on account switch / connection
        myDkgResult = null;
        myDkgSeed = "";
        myCommSecretHex = "";
        mySkShareHex = "";
        const output1 = document.getElementById('step1-output');
        output1.classList.add('hidden');
        output1.innerText = '';
        const output2 = document.getElementById('step2-output');
        output2.classList.add('hidden');
        output2.innerText = '';
        document.getElementById('btn-step1-register').disabled = true;

        // Instantiate Contract
        contract = new window.ethers.Contract(DEFAULT_REGISTRY_ADDRESS, REGISTRY_ABI, signer);
        document.getElementById('txt-contract-address').innerText = DEFAULT_REGISTRY_ADDRESS;

        // Verify if the account is one of the 5 auditors
        currentAuditorIndex = AUDITORS.findIndex(addr => addr.toLowerCase() === currentAddress.toLowerCase());
        
        updateWalletUI();
        await refreshContractState();

        // Safe deterministic signature-based key derivation for all connecting users
        showLoading("请在 MetaMask 中签名以安全派生您的 DKG/隐私通信私钥...");
        try {
            const message = `Sign this message to securely derive your DKG/privacy communication key.`;
            const signature = await signer.signMessage(message);
            
            // Hash signature to get 32-byte seed
            const seed = window.ethers.sha256(signature);
            myDkgSeed = seed.startsWith("0x") ? seed.slice(2) : seed;
            
            // Generate and cache the deterministic key result in memory
            const nodeId = currentAuditorIndex !== -1 ? currentAuditorIndex + 1 : 1;
            const dkgRes = wasm_generate_dkg_keys(nodeId, myDkgSeed);
            myCommSecretHex = dkgRes.communication_secret;
            myCommPublicHex = dkgRes.communication_key;
            
            showToast("通信私钥派生成功，已保存在内存中", "success");
        } catch (signErr) {
            console.error("Signature derivation failed:", signErr);
            showToast("签名派生私钥失败，相关计算及隐私接收功能将受限！: " + (signErr.message || signErr), "warning");
        } finally {
            hideLoading();
        }

        if (document.getElementById('txt-my-privacy-address')) {
            document.getElementById('txt-my-privacy-address').value = "0x" + myCommPublicHex;
        }

        // Auto-aggregate key shares if DKG is completed on-chain
        await autoAggregateMyShares();
    } catch (err) {
        console.error("Wallet connection failed:", err);
        showToast("连接钱包失败: " + err.message, "error");
    } finally {
        hideLoading();
    }
}

function updateWalletUI() {
    document.getElementById('btn-connect-wallet').classList.add('hidden');
    const walletInfo = document.getElementById('wallet-info');
    walletInfo.classList.remove('hidden');
    document.getElementById('txt-wallet-address').innerText = `${currentAddress.slice(0, 6)}...${currentAddress.slice(-4)}`;

    const roleBadge = document.getElementById('txt-auditor-role');
    const selectNodeId = document.getElementById('select-node-id');
    if (currentAuditorIndex !== -1) {
        roleBadge.innerText = `审计节点 ${currentAuditorIndex + 1}`;
        roleBadge.style.background = "rgba(16, 185, 129, 0.15)";
        roleBadge.style.color = "#34D399";
        roleBadge.style.borderColor = "rgba(16, 185, 129, 0.3)";
        
        // Select matching option in step 1 dropdown and lock it
        selectNodeId.value = (currentAuditorIndex + 1).toString();
        selectNodeId.disabled = true;
    } else {
        roleBadge.innerText = "外部观察者";
        roleBadge.style.background = "rgba(245, 158, 11, 0.15)";
        roleBadge.style.color = "#FBBF24";
        roleBadge.style.borderColor = "rgba(245, 158, 11, 0.3)";
        
        selectNodeId.disabled = false;
    }
}

// Fetch on-chain registry state and update status panel
async function refreshContractState() {
    if (!contract) return;
    
    try {
        const isCompleted = await contract.isDkgCompleted();
        const dkgStatusText = document.getElementById('txt-dkg-status');
        
        if (isCompleted) {
            dkgStatusText.innerText = "已完成 DKG";
            dkgStatusText.className = "status-badge status-complete";
            
            const globalKey = await contract.globalAuditPublicKey();
            document.getElementById('txt-global-pubkey').innerText = globalKey;
            document.getElementById('btn-encrypt-key').disabled = false;
        } else {
            dkgStatusText.innerText = "进行中 / 未公示";
            dkgStatusText.className = "status-badge status-pending";
            document.getElementById('txt-global-pubkey').innerText = "尚未生成";
        }

        // Fetch nodes table information
        const tbody = document.getElementById('nodes-table-body');
        tbody.innerHTML = "";

        let registeredKeysCount = 0;
        let commitmentsSubmittedCount = 0;

        for (let i = 0; i < 5; i++) {
            const auditorAddr = AUDITORS[i];
            const commKeyBytes = await contract.communicationPublicKeys(auditorAddr);
            const isRegistered = commKeyBytes && commKeyBytes !== "0x";
            if (isRegistered) registeredKeysCount++;

            // Check commitments (A_i,0)
            const comm0 = await contract.dkgCommitments(auditorAddr, 0);
            const hasCommitments = comm0 && comm0 !== "0x";
            if (hasCommitments) commitmentsSubmittedCount++;

            const tr = document.createElement('tr');
            if (isRegistered) tr.className = "registered-node";
            tr.innerHTML = `
                <td class="mono-text">节点 ${i + 1}</td>
                <td class="mono-text font-small">${auditorAddr.slice(0, 6)}...${auditorAddr.slice(-4)}</td>
                <td class="mono-text font-small">${isRegistered ? commKeyBytes.slice(0, 10) + "..." : '<span class="text-muted">未注册</span>'}</td>
                <td class="mono-text font-small">${hasCommitments ? comm0.slice(0, 10) + "..." : '<span class="text-muted">未提交</span>'}</td>
            `;
            tbody.appendChild(tr);
        }

        // Stepper state evaluation
        updateStepperActivation(registeredKeysCount, commitmentsSubmittedCount, isCompleted);
    } catch (err) {
        console.error("Failed to query contract state:", err);
        showToast("同步合约状态失败: " + err.message, "error");
    }
}

function updateStepperActivation(registeredKeys, commitmentsSubmitted, isCompleted) {
    const step1Item = document.getElementById('step-1-item');
    const step2Item = document.getElementById('step-2-item');
    const step3Item = document.getElementById('step-3-item');
    const step4Item = document.getElementById('step-4-item');

    // Reset classes
    [step1Item, step2Item, step3Item, step4Item].forEach(item => {
        item.classList.remove('active', 'completed');
    });

    // Check Step 1 completion
    const isMyKeyRegisteredOnChain = currentAuditorIndex !== -1; // dummy check for UI flow logic
    
    if (registeredKeys < 5) {
        step1Item.classList.add('active');
        document.getElementById('btn-step2-submit').disabled = true;
    } else {
        step1Item.classList.add('completed');
        
        if (commitmentsSubmitted < 5) {
            step2Item.classList.add('active');
            if (currentAuditorIndex !== -1) {
                document.getElementById('btn-step2-submit').disabled = false;
            }
        } else {
            step2Item.classList.add('completed');
            
            // Step 3 (Aggregate) is active if commitments are ready and global DKG isn't finalized
            if (!isCompleted) {
                step3Item.classList.add('active');
                if (currentAuditorIndex !== -1) {
                    document.getElementById('btn-step3-aggregate').disabled = false;
                }
                step4Item.classList.add('active'); // Finalize is also active
                document.getElementById('btn-step4-finalize').disabled = false;
            } else {
                step3Item.classList.add('completed');
                step4Item.classList.add('completed');
                document.getElementById('btn-step3-aggregate').disabled = false; // keep open for testing
                document.getElementById('btn-gen-my-share').disabled = false;
            }
        }
    }
}

// -------------------------------------------------------------
// DKG Step 1: Generate Polynomials, Commitments, Communication Key
// -------------------------------------------------------------
function generateLocalKeys() {
    const nodeIdSelect = document.getElementById('select-node-id');
    const nodeId = parseInt(nodeIdSelect.value, 10);
    
    if (!myDkgSeed) {
        showToast("未检测到派生 Seed，请重新连接钱包进行签名派生", "error");
        return;
    }

    showLoading(`正在本地使用 WASM 确定性生成节点 ${nodeId} 的密码学多项式与密钥对...`);
    
    setTimeout(() => { // defer to let loader show up
        try {
            // Generate locally using the derived seed
            const res = wasm_generate_dkg_keys(nodeId, myDkgSeed);
            myDkgResult = res;

            // Output info
            const output = document.getElementById('step1-output');
            output.classList.remove('hidden');
            output.innerText = `[本地生成成功]
节点ID: ${res.node_id}
通信公钥 (BN254 G1): ${res.communication_key.slice(0, 24)}...
通信私钥 (内存安全暂存): ${res.communication_secret.slice(0, 8)}...
承诺项(G1) a_0: ${res.commitments[0].slice(0, 24)}...
承诺项(G1) a_1: ${res.commitments[1].slice(0, 24)}...
承诺项(G1) a_2: ${res.commitments[2].slice(0, 24)}...
本地 5 份多项式评估分发碎片已生成。`;

            // Enable next button
            document.getElementById('btn-step1-register').disabled = false;
            showToast("本地密钥及承诺生成成功！", "success");
        } catch (err) {
            console.error("Local generation failed:", err);
            showToast("本地密钥生成失败: " + err, "error");
        } finally {
            hideLoading();
        }
    }, 100);
}

async function registerCommKey() {
    if (!contract || !myDkgResult) return;
    
    showLoading("正在向区块链注册通信公钥...");
    try {
        const commKeyHex = "0x" + myDkgResult.communication_key;
        const tx = await contract.registerCommunicationKey(commKeyHex);
        showToast("注册交易已发送，等待链上确认...", "info");
        await tx.wait();
        
        showToast("通信公钥注册成功！", "success");
        await refreshContractState();
    } catch (err) {
        console.error("Registration failed:", err);
        showToast("注册通信公钥失败: " + err.message, "error");
    } finally {
        hideLoading();
    }
}

// -------------------------------------------------------------
// DKG Step 2: Compute and Submit Shares to Contract
// -------------------------------------------------------------
async function submitDkgData() {
    if (!contract || !myDkgResult) {
        showToast("请先在第一步中生成本地密钥", "error");
        return;
    }

    showLoading("正在使用各节点公钥加密并向合约广播多项式承诺与评估碎片...");
    try {
        // Format commitments: bytes[3]
        const commitments = myDkgResult.commitments.map(c => "0x" + c);
        
        // Format recipients: address[5]
        const recipients = AUDITORS;
        
        // Format encrypted shares for each recipient: bytes[5]
        const encryptedShares = [];
        for (let i = 0; i < 5; i++) {
            const recipientAddress = AUDITORS[i];
            const recipientPubKeyBytes = await contract.communicationPublicKeys(recipientAddress);
            if (!recipientPubKeyBytes || recipientPubKeyBytes === "0x") {
                throw new Error(`节点 ${i + 1} (${recipientAddress}) 尚未在区块链上注册其通信公钥！无法加密发送碎片。请等待所有节点完成第一步。`);
            }
            const cleanRecipientPubKey = recipientPubKeyBytes.startsWith("0x") ? recipientPubKeyBytes.slice(2) : recipientPubKeyBytes;
            
            // Encrypt the share
            const localShareHex = myDkgResult.shares[i];
            const encryptedShareHex = wasm_encrypt_dkg_share(localShareHex, cleanRecipientPubKey);
            encryptedShares.push("0x" + encryptedShareHex);
        }

        const tx = await contract.submitDkgData(commitments, recipients, encryptedShares);
        showToast("提交 DKG 数据交易已发送，等待确认...", "info");
        await tx.wait();

        const output = document.getElementById('step2-output');
        output.classList.remove('hidden');
        output.innerText = `[DKG 数据成功提交]
承诺列表已上链公示。
发往各审计节点的 5 个加密多项式评估碎片已成功加密入库。`;

        showToast("DKG 数据及碎片加密提交成功！", "success");
        await refreshContractState();
    } catch (err) {
        console.error("DKG Submission failed:", err);
        showToast("提交 DKG 碎片失败: " + err.message, "error");
    } finally {
        hideLoading();
    }
}

// -------------------------------------------------------------
// DKG Step 3: Fetch Shares and Aggregate local private key share sk_j
// -------------------------------------------------------------
async function aggregateMyShares() {
    if (!contract) return;
    const nodeId = currentAuditorIndex !== -1 ? currentAuditorIndex + 1 : parseInt(document.getElementById('select-node-id').value, 10);
    const auditorAddress = AUDITORS[nodeId - 1];

    showLoading(`正在拉取并解密发给节点 ${nodeId} (${auditorAddress}) 的所有加密碎片...`);
    
    try {
        if (!myCommSecretHex) {
            throw new Error(`本地内存中未找到节点 ${nodeId} 的通信私钥！请重新连接钱包进行签名初始化。`);
        }

        const fetchedShares = [];
        
        // Pull and decrypt shares from all 5 senders
        for (let i = 0; i < 5; i++) {
            const senderAddr = AUDITORS[i];
            const shareBytes = await contract.encryptedShares(senderAddr, auditorAddress);
            if (!shareBytes || shareBytes === "0x") {
                throw new Error(`来自节点 ${i + 1} (${senderAddr}) 的评估碎片尚未上链！请等待所有节点完成第 2 步。`);
            }
            
            // Decrypt the share using our communication private key
            const cleanEncryptedShare = shareBytes.slice(2);
            const decryptedShareHex = wasm_decrypt_dkg_share(cleanEncryptedShare, myCommSecretHex);
            fetchedShares.push(decryptedShareHex);
        }

        // Call WASM aggregation on the decrypted shares
        const sharesJson = JSON.stringify(fetchedShares);
        const skShareHex = wasm_aggregate_shares(sharesJson, nodeId);
        
        // Save sk_share to in-memory state
        mySkShareHex = skShareHex;
        localStorage.removeItem(`sk_share_node_${nodeId}`); // Clean up any old storage

        const output = document.getElementById('step3-output');
        output.classList.remove('hidden');
        output.innerText = `[私钥碎片合成成功]
收到的 5 份碎片经解密后已在本地拉格朗日聚合。
您的私钥碎片 sk_${nodeId} = ${skShareHex.slice(0, 32)}...
(已安全暂存在运行内存中，不写入硬盘)`;

        showToast(`审计节点 ${nodeId} 的私钥碎片聚合成功！`, "success");
        if (currentAuditorIndex !== -1) {
            document.getElementById('btn-gen-my-share').disabled = false;
        }
    } catch (err) {
        console.error("Aggregation failed:", err);
        showToast("聚合失败: " + err.message, "error");
    } finally {
        hideLoading();
    }
}

async function autoAggregateMyShares() {
    if (!contract || currentAuditorIndex === -1) return;
    
    try {
        const isCompleted = await contract.isDkgCompleted();
        if (!isCompleted) return;
        
        const nodeId = currentAuditorIndex + 1;
        const auditorAddress = AUDITORS[currentAuditorIndex];
        
        if (!myCommSecretHex) {
            console.log("[Auto-Aggregate] myCommSecretHex is empty, cannot auto-aggregate private key shares.");
            return;
        }

        const fetchedShares = [];
        for (let i = 0; i < 5; i++) {
            const senderAddr = AUDITORS[i];
            const shareBytes = await contract.encryptedShares(senderAddr, auditorAddress);
            if (!shareBytes || shareBytes === "0x") {
                console.log(`[Auto-Aggregate] Share from ${senderAddr} is empty on-chain, DKG state might be incomplete.`);
                return;
            }
            
            const cleanEncryptedShare = shareBytes.slice(2);
            const decryptedShareHex = wasm_decrypt_dkg_share(cleanEncryptedShare, myCommSecretHex);
            fetchedShares.push(decryptedShareHex);
        }

        const sharesJson = JSON.stringify(fetchedShares);
        mySkShareHex = wasm_aggregate_shares(sharesJson, nodeId);
        console.log(`[Auto-Aggregate] Successfully auto-aggregated private key share sk_${nodeId} = ${mySkShareHex.slice(0, 8)}...`);
        showToast(`已自动载入并聚合节点 ${nodeId} 的私钥碎片`, "success");

        // Enable buttons
        document.getElementById('btn-gen-my-share').disabled = false;
        if (document.getElementById('btn-audit-gen-share')) {
            document.getElementById('btn-audit-gen-share').disabled = false;
        }
    } catch (err) {
        console.error("[Auto-Aggregate] Failed to auto-aggregate shares:", err);
    }
}

// -------------------------------------------------------------
// DKG Step 4: Finalize Global Public Key
// -------------------------------------------------------------
async function finalizeGlobalKey() {
    if (!contract) return;
    showLoading("计算最终全局公钥中...");
    
    try {
        // Collect commitments a0 from all 5 nodes
        const a0s = [];
        for (let i = 0; i < 5; i++) {
            const auditorAddr = AUDITORS[i];
            const a0 = await contract.dkgCommitments(auditorAddr, 0);
            if (!a0 || a0 === "0x") {
                throw new Error(`节点 ${i + 1} (${auditorAddr}) 尚未提交多项式承诺！无法合成全局公钥。`);
            }
            // Strip "0x" prefix for WASM input
            a0s.push(a0.startsWith("0x") ? a0.slice(2) : a0);
        }

        // Call WASM function to compute the aggregated global public key
        const commitmentsJson = JSON.stringify(a0s);
        const globalKeyHex = wasm_aggregate_global_public_key(commitmentsJson);
        const formattedGlobalKey = "0x" + globalKeyHex;
        
        const tx = await contract.finalizeGlobalPublicKey(formattedGlobalKey);
        showToast("提交全局公钥公示交易...", "info");
        await tx.wait();

        showToast("全局公钥公示成功，DKG 正式完成！", "success");
        await refreshContractState();
    } catch (err) {
        console.error("Finalization failed:", err);
        showToast("公示全局公钥失败: " + err.message, "error");
    } finally {
        hideLoading();
    }
}

// -------------------------------------------------------------
// Audit Panel Part 1: Encrypt Transaction Symmetric Key
// -------------------------------------------------------------
function generateRandomSymKey() {
    const randomHex = Array.from({ length: 31 }, () => 
        Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
    ).join('') + "00";
    document.getElementById('input-sym-key').value = randomHex;
    showToast("随机对称密钥已生成", "success");
}

function encryptSymKey() {
    const globalKeyHex = document.getElementById('txt-global-pubkey').innerText;
    const symKeyHex = document.getElementById('input-sym-key').value;

    if (!symKeyHex) {
        showToast("请输入或生成一个对称密钥", "error");
        return;
    }

    try {
        // globalKeyHex is prefixed with "0x"
        const cleanGlobalKey = globalKeyHex.startsWith("0x") ? globalKeyHex.slice(2) : globalKeyHex;
        
        const ciphertextHex = wasm_encrypt_audit_key(cleanGlobalKey, symKeyHex);
        
        const outBlock = document.getElementById('encrypt-output');
        outBlock.classList.remove('hidden');
        document.getElementById('txt-ciphertext-out').value = ciphertextHex;
        
        // Automatically paste to decryption text area
        document.getElementById('input-ciphertext').value = ciphertextHex;

        showToast("加密生成审计密文成功！", "success");
    } catch (err) {
        console.error("Encryption failed:", err);
        showToast("加密失败: " + err, "error");
    }
}

// -------------------------------------------------------------
// Audit Panel Part 2: Decrypt with Node private share
// -------------------------------------------------------------
function computeDecryptionShare() {
    const nodeId = currentAuditorIndex !== -1 ? currentAuditorIndex + 1 : parseInt(document.getElementById('select-node-id').value, 10);
    const ciphertext = document.getElementById('input-ciphertext').value;
    
    if (!ciphertext) {
        showToast("请先在输入框中粘贴审计密文", "error");
        return;
    }

    const skShareHex = mySkShareHex;
    if (!skShareHex) {
        showToast(`本地内存中未找到节点 ${nodeId} 的私钥碎片！请先执行 Step 3 (拉取并聚合私钥碎片)。`, "error");
        return;
    }

    try {
        const sharePointHex = wasm_decrypt_share(ciphertext, skShareHex, nodeId);
        
        // Add to collected shares pool if not already present
        const index = collectedDecryptionShares.findIndex(s => s.node_id === nodeId);
        const newShare = { node_id: nodeId, share_point_hex: sharePointHex };
        
        if (index !== -1) {
            collectedDecryptionShares[index] = newShare;
        } else {
            collectedDecryptionShares.push(newShare);
        }

        updateSharesPoolUI();
        showToast(`成功计算节点 ${nodeId} 的局部解密份额！`, "success");
        
        if (collectedDecryptionShares.length >= 3) {
            document.getElementById('btn-aggregate-decryption').disabled = false;
        }
    } catch (err) {
        console.error("Failed to compute decryption share:", err);
        showToast("计算解密份额失败: " + err, "error");
    }
}

function updateSharesPoolUI() {
    const container = document.getElementById('shares-pool-list');
    container.innerHTML = "";

    if (collectedDecryptionShares.length === 0) {
        container.innerHTML = `<div class="empty-shares">暂未收集到解密份额，请点击“计算我的解密份额”或手动导入。</div>`;
        return;
    }

    collectedDecryptionShares.forEach(share => {
        const badge = document.createElement('div');
        badge.className = "share-badge";
        badge.innerHTML = `
            <span class="share-node-label">审计节点 ${share.node_id}</span>
            <span class="mono-text font-small">${share.share_point_hex.slice(0, 24)}...</span>
        `;
        container.appendChild(badge);
    });
}

function importManualShare() {
    const nodeId = parseInt(document.getElementById('import-node-id').value, 10);
    const shareHex = document.getElementById('import-share-hex').value.trim();

    if (!shareHex) {
        showToast("请输入解密份额 Hex 点数据", "error");
        return;
    }

    const index = collectedDecryptionShares.findIndex(s => s.node_id === nodeId);
    const newShare = { node_id: nodeId, share_point_hex: shareHex };

    if (index !== -1) {
        collectedDecryptionShares[index] = newShare;
    } else {
        collectedDecryptionShares.push(newShare);
    }

    updateSharesPoolUI();
    document.getElementById('import-share-hex').value = "";
    showToast(`成功导入节点 ${nodeId} 的解密份额`, "success");

    if (collectedDecryptionShares.length >= 3) {
        document.getElementById('btn-aggregate-decryption').disabled = false;
    }
}

// -------------------------------------------------------------
// Audit Panel Part 3: Aggregate Decryption Shares to recover SymKey
// -------------------------------------------------------------
function aggregateDecryption() {
    const ciphertext = document.getElementById('input-ciphertext').value;
    
    if (collectedDecryptionShares.length < 3) {
        showToast("解密需要至少 3 个节点的解密份额！", "error");
        return;
    }

    showLoading("利用门限拉格朗日插值解密中...");

    setTimeout(() => {
        try {
            const sharesJson = JSON.stringify(collectedDecryptionShares);
            const decryptedSymKey = wasm_threshold_decrypt(ciphertext, sharesJson);
            
            const outBlock = document.getElementById('decrypt-output');
            outBlock.classList.remove('hidden');
            document.getElementById('txt-decrypted-key').innerText = "0x" + decryptedSymKey;

            showToast("门限解密成功！对称密钥已恢复。", "success");
        } catch (err) {
            console.error("Threshold decryption failed:", err);
            showToast("门限解密失败: " + err, "error");
        } finally {
            hideLoading();
        }
    }, 200);
}

// -------------------------------------------------------------
// Cryptographic Helpers (AES-GCM Web Crypto)
// -------------------------------------------------------------

// Encrypt text with a 32-byte hex key using AES-GCM (Web Crypto API)
async function encryptWithSymKey(text, hexKey) {
    const keyBytes = new Uint8Array(hexKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const cryptoKey = await window.crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "AES-GCM" },
        false,
        ["encrypt"]
    );
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const encrypted = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        cryptoKey,
        enc.encode(text)
    );
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    return "0x" + Array.from(combined).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Decrypt text with a 32-byte hex key using AES-GCM (Web Crypto API)
async function decryptWithSymKey(hexCiphertext, hexKey) {
    const cleanCipher = hexCiphertext.startsWith("0x") ? hexCiphertext.slice(2) : hexCiphertext;
    const cipherBytes = new Uint8Array(cleanCipher.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const keyBytes = new Uint8Array(hexKey.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    
    const cryptoKey = await window.crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "AES-GCM" },
        false,
        ["decrypt"]
    );
    const iv = cipherBytes.slice(0, 12);
    const encryptedData = cipherBytes.slice(12);
    
    const decrypted = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        cryptoKey,
        encryptedData
    );
    const dec = new TextDecoder();
    return dec.decode(decrypted);
}

// -------------------------------------------------------------
// Privacy Wallet & Audit Functions
// -------------------------------------------------------------

// Load notes from local storage
function getLocalNotes() {
    if (!currentAddress) return [];
    const key = `shielded_notes_${currentAddress.toLowerCase()}`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
}

// Save notes to local storage
function saveLocalNotes(notes) {
    if (!currentAddress) return;
    const key = `shielded_notes_${currentAddress.toLowerCase()}`;
    localStorage.setItem(key, JSON.stringify(notes));
}

// Mint test coins using Anvil Key 0
async function walletMint() {
    if (!provider || !currentAddress) {
        showToast("请先连接钱包", "error");
        return;
    }
    showLoading("正在从水龙头领用 1000 MCK 测试币...");
    try {
        const faucetWallet = new window.ethers.Wallet(ANVIL_FAUCET_PRIVATE_KEY, provider);
        const tokenContract = new window.ethers.Contract(MOCK_TOKEN_ADDRESS, TOKEN_ABI, faucetWallet);
        
        const amountWei = window.ethers.parseUnits("1000", 18);
        const tx = await tokenContract.transfer(currentAddress, amountWei);
        showToast("水龙头交易已发送...", "info");
        await tx.wait();
        
        showToast("领用 1000 MCK 测试币成功！", "success");
        await refreshWalletState();
    } catch (err) {
        console.error("Faucet transfer failed:", err);
        showToast("领用失败: " + err.message, "error");
    } finally {
        hideLoading();
    }
}

// Update public & private balances and notes list
async function refreshWalletState() {
    if (!signer || !currentAddress) return;
    try {
        const tokenContract = new window.ethers.Contract(MOCK_TOKEN_ADDRESS, TOKEN_ABI, signer);
        const poolContract = new window.ethers.Contract(SHIELDED_POOL_ADDRESS, SHIELDED_POOL_ABI, signer);
        
        // 1. Fetch public MCK balance
        const balanceWei = await tokenContract.balanceOf(currentAddress);
        const balanceEth = window.ethers.formatUnits(balanceWei, 18);
        document.getElementById('txt-public-balance').innerText = `${parseFloat(balanceEth).toFixed(2)} MCK`;
        
        // 1.5 Scan chain for E2E encrypted notes addressed to us (using our communication private key)
        const notes = getLocalNotes();
        let notesUpdated = false;
        if (myCommSecretHex) {
            try {
                const filter = poolContract.filters.Transact();
                const events = await poolContract.queryFilter(filter, 0, 'latest');
                for (const evt of events) {
                    const rawEncryptedData = evt.args.encryptedAuditData;
                    if (!rawEncryptedData || rawEncryptedData === "0x") continue;
                    
                    try {
                        const cleanHex = rawEncryptedData.startsWith("0x") ? rawEncryptedData.slice(2) : rawEncryptedData;
                        const jsonStr = new TextDecoder().decode(new Uint8Array(cleanHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))));
                        const payload = JSON.parse(jsonStr);
                        
                        if (payload && payload.recipient) {
                            const encSymKey = payload.recipient.encSymKey.startsWith("0x") ? payload.recipient.encSymKey.slice(2) : payload.recipient.encSymKey;
                            const noteCipher = payload.recipient.noteCipher;
                            
                            // Try decrypting the recipient symmetric key with our communication private key
                            let decryptedSymKey;
                            try {
                                decryptedSymKey = wasm_decrypt_dkg_share(encSymKey, myCommSecretHex);
                            } catch (decErr) {
                                // Decryption fails if the note wasn't encrypted for us, ignore it
                                continue;
                            }
                            
                            // Decrypt note details
                            const decryptedNoteJson = await decryptWithSymKey(noteCipher, decryptedSymKey);
                            const noteObj = JSON.parse(decryptedNoteJson);
                            
                            // Verify note commitment
                            const expectedCommitmentHex = wasm_create_note_commitment(BigInt(noteObj.amount), noteObj.secret, noteObj.blinding);
                            const expectedCommitmentBytes32 = "0x" + expectedCommitmentHex;
                            
                            // Save if not already registered locally
                            const alreadyExists = notes.some(n => n.commitment.toLowerCase() === expectedCommitmentBytes32.toLowerCase());
                            if (!alreadyExists) {
                                const nextLeafIdx = await poolContract.nextLeafIndex();
                                let foundLeafIdx = -1;
                                for (let idx = 0; idx < Number(nextLeafIdx); idx++) {
                                    const leaf = await poolContract.leaves(idx);
                                    if (leaf.toLowerCase() === expectedCommitmentBytes32.toLowerCase()) {
                                        foundLeafIdx = idx;
                                        break;
                                    }
                                }
                                
                                if (foundLeafIdx !== -1) {
                                    notes.push({
                                        commitment: expectedCommitmentBytes32,
                                        amount: noteObj.amount,
                                        secret: noteObj.secret,
                                        blinding: noteObj.blinding,
                                        leafIndex: foundLeafIdx,
                                        spent: false
                                    });
                                    notesUpdated = true;
                                }
                            }
                        }
                    } catch (e) {
                        // Suppress parsing errors for legacy transactions
                    }
                }
            } catch (scanErr) {
                console.error("Scanning chain for notes failed:", scanErr);
            }
        }
        if (notesUpdated) {
            saveLocalNotes(notes);
        }
        
        // 2. Fetch spent status of local notes and update
        let privateSum = 0;
        for (let note of notes) {
            if (!note.spent) {
                const nullifierHex = wasm_create_note_nullifier(note.secret, BigInt(note.leafIndex));
                const isSpent = await poolContract.isSpent("0x" + nullifierHex);
                if (isSpent) {
                    note.spent = true;
                } else {
                    privateSum += note.amount;
                }
            }
        }
        saveLocalNotes(notes);
        document.getElementById('txt-private-balance').innerText = `${privateSum.toFixed(2)} MCK`;
        
        // 3. Render notes table
        const tbody = document.getElementById('wallet-notes-body');
        tbody.innerHTML = "";
        
        if (notes.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">暂无隐私资产 Note</td></tr>`;
        } else {
            notes.forEach((note, idx) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="mono-text">${note.leafIndex}</td>
                    <td class="mono-text highlight-text">${note.amount.toFixed(2)}</td>
                    <td class="mono-text font-small">${note.secret.slice(0, 16)}...</td>
                    <td>
                        <span class="status-badge ${note.spent ? 'status-pending' : 'status-complete'}">
                            ${note.spent ? '已花费' : '可用'}
                        </span>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (err) {
        console.error("Refresh wallet state failed:", err);
        showToast("刷新余额及隐私资产失败: " + err.message, "error");
    }
}

// Approve Token
async function walletApprove() {
    if (!signer) {
        showToast("请先连接钱包", "error");
        return;
    }
    const amountVal = parseFloat(document.getElementById('input-deposit-amount').value);
    if (isNaN(amountVal) || amountVal <= 0) {
        showToast("请输入有效的存款金额", "error");
        return;
    }
    
    showLoading("正在向 MockToken 授权额度...");
    try {
        const tokenContract = new window.ethers.Contract(MOCK_TOKEN_ADDRESS, TOKEN_ABI, signer);
        const amountWei = window.ethers.parseUnits(amountVal.toString(), 18);
        const tx = await tokenContract.approve(SHIELDED_POOL_ADDRESS, amountWei);
        showToast("授权交易已发送，等待确认...", "info");
        await tx.wait();
        showToast("授权代币成功！现在可以进行存款。", "success");
        document.getElementById('btn-wallet-deposit').disabled = false;
    } catch (err) {
        console.error("Approve failed:", err);
        showToast("授权失败: " + err.message, "error");
    } finally {
        hideLoading();
    }
}

// Deposit Token into Shielded Pool
async function walletDeposit() {
    if (!signer) {
        showToast("请先连接钱包", "error");
        return;
    }
    const amountVal = Math.floor(parseFloat(document.getElementById('input-deposit-amount').value));
    if (isNaN(amountVal) || amountVal <= 0) {
        showToast("请输入有效的存入金额 (整型 MCK)", "error");
        return;
    }

    showLoading("正在生成 Note 承诺，发送存款交易...");
    try {
        const poolContract = new window.ethers.Contract(SHIELDED_POOL_ADDRESS, SHIELDED_POOL_ABI, signer);
        
        const secretHex = Array.from({ length: 31 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('') + "00";
        const blindingHex = Array.from({ length: 31 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('') + "00";
        
        const commitmentHex = wasm_create_note_commitment(BigInt(amountVal), secretHex, blindingHex);
        const commitmentBytes32 = "0x" + commitmentHex;
        
        const amountWei = window.ethers.parseUnits(amountVal.toString(), 18);
        const tx = await poolContract.deposit(commitmentBytes32, amountWei);
        showToast("存款交易已发送...", "info");
        await tx.wait();
        
        let leafIndex = 0;
        try {
            const nextIdx = await poolContract.nextLeafIndex();
            leafIndex = Number(nextIdx) - 1;
        } catch (idxErr) {
            console.error("Fetch leafIndex failed:", idxErr);
        }
        
        const notes = getLocalNotes();
        notes.push({
            commitment: commitmentBytes32,
            amount: amountVal,
            secret: secretHex,
            blinding: blindingHex,
            leafIndex: leafIndex,
            spent: false
        });
        saveLocalNotes(notes);
        
        showToast("存款上链成功！已转换为隐私 Note。", "success");
        document.getElementById('btn-wallet-deposit').disabled = true;
        await refreshWalletState();
    } catch (err) {
        console.error("Deposit failed:", err);
        showToast("存款失败: " + (err.message || err), "error");
    } finally {
        hideLoading();
    }
}

// Transfer (Shielded Transaction)
async function walletTransfer() {
    if (!signer) {
        showToast("请先连接钱包", "error");
        return;
    }
    const recipientAddr = document.getElementById('input-transfer-recipient').value.trim();
    const recipientPubKeyRaw = document.getElementById('input-transfer-recipient-pubkey').value.trim();
    const transferAmount = Math.floor(parseFloat(document.getElementById('input-transfer-amount').value));
    
    if (!window.ethers.isAddress(recipientAddr)) {
        showToast("请输入合法的以太坊接收地址 (合规审计申报)", "error");
        return;
    }
    const cleanRecipientPubKey = recipientPubKeyRaw.startsWith("0x") ? recipientPubKeyRaw.slice(2) : recipientPubKeyRaw;
    if (cleanRecipientPubKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(cleanRecipientPubKey)) {
        showToast("请输入接收方隐私收款地址 (64位十六进制公钥)", "error");
        return;
    }
    if (isNaN(transferAmount) || transferAmount <= 0) {
        showToast("请输入有效的转账金额", "error");
        return;
    }

    const notes = getLocalNotes().filter(n => !n.spent);
    const inputNote = notes.find(n => n.amount >= transferAmount);
    if (!inputNote) {
        showToast("没有足够额度的可用隐私 Note 碎片进行本次转账！", "error");
        return;
    }

    const globalKeyText = document.getElementById('txt-global-pubkey').innerText;
    if (!globalKeyText || globalKeyText === "尚未生成" || globalKeyText === "未公示") {
        showToast("门限 DKG 尚未公示全局审计公钥，暂无法进行隐私转账加密！", "error");
        return;
    }

    showLoading("正在使用全局审计公钥进行门限合规加密并打包交易...");
    
    try {
        // Direct E2E encryption using recipient's pasted public key (no on-chain address association)

        const poolContract = new window.ethers.Contract(SHIELDED_POOL_ADDRESS, SHIELDED_POOL_ABI, signer);
        
        const nullifier1Hex = wasm_create_note_nullifier(inputNote.secret, BigInt(inputNote.leafIndex));
        const nullifier1 = "0x" + nullifier1Hex;
        const nullifier2 = "0x" + Array.from({ length: 31 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('') + "00";
        
        const recSecret = Array.from({ length: 31 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('') + "00";
        const recBlinding = Array.from({ length: 31 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('') + "00";
        const recCommitmentHex = wasm_create_note_commitment(BigInt(transferAmount), recSecret, recBlinding);
        const commitment1 = "0x" + recCommitmentHex;
        
        const changeAmount = inputNote.amount - transferAmount;
        let commitment2 = "0x" + "00".repeat(32);
        let changeSecret = "";
        let changeBlinding = "";
        
        if (changeAmount > 0) {
            changeSecret = Array.from({ length: 31 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('') + "00";
            changeBlinding = Array.from({ length: 31 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('') + "00";
            const changeCommitmentHex = wasm_create_note_commitment(BigInt(changeAmount), changeSecret, changeBlinding);
            commitment2 = "0x" + changeCommitmentHex;
        }

        // Auditor Encryption (DKG Threshold)
        const symKey = Array.from({ length: 31 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('') + "00";
        const cleanGlobalKey = globalKeyText.startsWith("0x") ? globalKeyText.slice(2) : globalKeyText;
        const c_key_hex = wasm_encrypt_audit_key(cleanGlobalKey, symKey);
        
        const word1 = "0x" + c_key_hex.slice(0, 64);
        const word2 = "0x" + c_key_hex.slice(64, 128);
        const auditCiphertext = [word1, word2, 0, 0];

        const conclusion = transferAmount < 500 ? "合规 🟢" : "大额警报 ⚠️";
        const complianceObj = {
            sender: currentAddress,
            recipient: recipientAddr,
            amount: transferAmount,
            conclusion: conclusion
        };
        const encryptedAuditorDataHex = await encryptWithSymKey(JSON.stringify(complianceObj), symKey);

        // Recipient E2E Encryption (ElGamal G1 + AES-GCM)
        const noteDetails = {
            amount: transferAmount,
            secret: recSecret,
            blinding: recBlinding
        };
        const recSymKey = Array.from({ length: 31 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('') + "00";
        const noteCiphertext = await encryptWithSymKey(JSON.stringify(noteDetails), recSymKey);
        const encSymKeyHex = wasm_encrypt_dkg_share(recSymKey, cleanRecipientPubKey);

        // Package both encryption streams into a single JSON payload for encryptedAuditData
        const mixedPayload = {
            auditor: encryptedAuditorDataHex,
            recipient: {
                encSymKey: "0x" + encSymKeyHex,
                noteCipher: noteCiphertext
            }
        };
        const finalEncryptedDataHex = "0x" + Array.from(new TextEncoder().encode(JSON.stringify(mixedPayload))).map(b => b.toString(16).padStart(2, '0')).join('');

        const mockProof = window.ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256[2]", "uint256[2][2]", "uint256[2]"],
            [[0, 0], [[0, 0], [0, 0]], [0, 0]]
        );
        const currentRoot = await poolContract.getRoot();

        const tx = await poolContract.transact(
            mockProof,
            currentRoot,
            "0x" + "00".repeat(32),
            nullifier1,
            nullifier2,
            commitment1,
            commitment2,
            0,
            "0x" + "00".repeat(20),
            "0x" + "00".repeat(20),
            0,
            finalEncryptedDataHex,
            auditCiphertext
        );

        showToast("隐私转账交易已发送...", "info");
        await tx.wait();

        const localNotes = getLocalNotes();
        const noteIdx = localNotes.findIndex(n => n.leafIndex === inputNote.leafIndex);
        if (noteIdx !== -1) {
            localNotes[noteIdx].spent = true;
        }

        let newLeafIdx = 0;
        try {
            const nextIdx = await poolContract.nextLeafIndex();
            newLeafIdx = Number(nextIdx);
        } catch (e) {
            console.error(e);
        }

        // Recipient Note is stored on-chain! Bob will scan and decrypt it automatically.
        // We only save our own change note (if changeAmount > 0)
        if (changeAmount > 0) {
            localNotes.push({
                commitment: commitment2,
                amount: changeAmount,
                secret: changeSecret,
                blinding: changeBlinding,
                leafIndex: newLeafIdx - 1,
                spent: false
            });
        }
        saveLocalNotes(localNotes);

        showToast("隐私转账完成！余额及资产 Note 已更新。", "success");
        await refreshWalletState();
    } catch (err) {
        console.error("Transfer failed:", err);
        showToast("隐私转账失败: " + (err.message || err), "error");
    } finally {
        hideLoading();
    }
}

// Withdraw Token (Shielded Note -> Public Account)
async function walletWithdraw() {
    if (!signer) {
        showToast("请先连接钱包", "error");
        return;
    }
    const withdrawAmount = Math.floor(parseFloat(document.getElementById('input-withdraw-amount').value));
    let recipientAddr = document.getElementById('input-withdraw-recipient').value.trim();
    if (!recipientAddr) {
        recipientAddr = currentAddress;
    }

    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
        showToast("请输入有效的提款金额", "error");
        return;
    }
    if (!window.ethers.isAddress(recipientAddr)) {
        showToast("接收方以太坊地址无效", "error");
        return;
    }

    const notes = getLocalNotes().filter(n => !n.spent);
    const inputNote = notes.find(n => n.amount >= withdrawAmount);
    if (!inputNote) {
        showToast("未找到可用额度的隐私 Note 碎片进行提款！", "error");
        return;
    }

    const globalKeyText = document.getElementById('txt-global-pubkey').innerText;
    if (!globalKeyText || globalKeyText === "尚未生成" || globalKeyText === "未公示") {
        showToast("门限 DKG 未公示全局公钥，无法生成提款审计证明！", "error");
        return;
    }

    showLoading("正在使用门限审计机制打包提款交易...");

    try {
        const poolContract = new window.ethers.Contract(SHIELDED_POOL_ADDRESS, SHIELDED_POOL_ABI, signer);
        
        const nullifier1Hex = wasm_create_note_nullifier(inputNote.secret, BigInt(inputNote.leafIndex));
        const nullifier1 = "0x" + nullifier1Hex;
        const nullifier2 = "0x" + Array.from({ length: 31 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('') + "00";
        
        const changeAmount = inputNote.amount - withdrawAmount;
        let commitment1 = "0x" + "00".repeat(32);
        let changeSecret = "";
        let changeBlinding = "";
        
        if (changeAmount > 0) {
            changeSecret = Array.from({ length: 31 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('') + "00";
            changeBlinding = Array.from({ length: 31 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('') + "00";
            const changeCommitmentHex = wasm_create_note_commitment(BigInt(changeAmount), changeSecret, changeBlinding);
            commitment1 = "0x" + changeCommitmentHex;
        }
        const commitment2 = "0x" + "00".repeat(32);

        const symKey = Array.from({ length: 31 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('') + "00";
        const cleanGlobalKey = globalKeyText.startsWith("0x") ? globalKeyText.slice(2) : globalKeyText;
        const c_key_hex = wasm_encrypt_audit_key(cleanGlobalKey, symKey);
        
        const word1 = "0x" + c_key_hex.slice(0, 64);
        const word2 = "0x" + c_key_hex.slice(64, 128);
        const auditCiphertext = [word1, word2, 0, 0];

        const complianceObj = {
            sender: currentAddress,
            recipient: recipientAddr,
            amount: withdrawAmount,
            conclusion: "提款公开账户 🟢"
        };
        const encryptedDataHex = await encryptWithSymKey(JSON.stringify(complianceObj), symKey);

        const mockProof = window.ethers.AbiCoder.defaultAbiCoder().encode(
            ["uint256[2]", "uint256[2][2]", "uint256[2]"],
            [[0, 0], [[0, 0], [0, 0]], [0, 0]]
        );
        const currentRoot = await poolContract.getRoot();
        const withdrawWei = window.ethers.parseUnits(withdrawAmount.toString(), 18);
        const negativeAmount = -BigInt(withdrawWei);

        const tx = await poolContract.transact(
            mockProof,
            currentRoot,
            "0x" + "00".repeat(32),
            nullifier1,
            nullifier2,
            commitment1,
            commitment2,
            negativeAmount,
            recipientAddr,
            "0x" + "00".repeat(20),
            0,
            encryptedDataHex,
            auditCiphertext
        );

        showToast("提款交易已发送...", "info");
        await tx.wait();

        const localNotes = getLocalNotes();
        const noteIdx = localNotes.findIndex(n => n.leafIndex === inputNote.leafIndex);
        if (noteIdx !== -1) {
            localNotes[noteIdx].spent = true;
        }

        let newLeafIdx = 0;
        try {
            const nextIdx = await poolContract.nextLeafIndex();
            newLeafIdx = Number(nextIdx);
        } catch (e) {
            console.error(e);
        }

        if (changeAmount > 0) {
            localNotes.push({
                commitment: commitment1,
                amount: changeAmount,
                secret: changeSecret,
                blinding: changeBlinding,
                leafIndex: newLeafIdx - 1,
                spent: false
            });
        }
        saveLocalNotes(localNotes);

        showToast("提款成功，代币已转回您的公开余额！", "success");
        await refreshWalletState();
    } catch (err) {
        console.error("Withdraw failed:", err);
        showToast("提款失败: " + (err.message || err), "error");
    } finally {
        hideLoading();
    }
}

// -------------------------------------------------------------
// Compliance Auditor Queries
// -------------------------------------------------------------

// Fetch on-chain transact events and populate table
async function refreshAuditTxs() {
    if (!signer) return;
    try {
        const poolContract = new window.ethers.Contract(SHIELDED_POOL_ADDRESS, SHIELDED_POOL_ABI, signer);
        const tbody = document.getElementById('audit-txs-body');
        tbody.innerHTML = `<tr><td colspan="4" class="text-center">正在检索链上交易日志...</td></tr>`;
        
        const filter = poolContract.filters.Transact();
        const events = await poolContract.queryFilter(filter, 0, 'latest');
        
        tbody.innerHTML = "";
        if (events.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">暂未检测到链上隐私交易事件</td></tr>`;
            return;
        }

        events.reverse().forEach(evt => {
            const tr = document.createElement('tr');
            tr.className = "cursor-pointer";
            
            const auditCipher = evt.args.auditCiphertext;
            const w1 = BigInt(auditCipher[0]).toString(16).padStart(64, '0');
            const w2 = BigInt(auditCipher[1]).toString(16).padStart(64, '0');
            const c_key_hex = w1 + w2;
            
            tr.innerHTML = `
                <td class="mono-text font-small text-gradient">${evt.transactionHash.slice(0, 10)}...</td>
                <td class="mono-text font-small">${evt.args.commitment1.slice(0, 12)}...</td>
                <td class="mono-text font-small">${evt.args.commitment2.slice(0, 12)}...</td>
                <td class="mono-text font-small text-truncate" style="max-width: 150px;">${c_key_hex.slice(0, 20)}...</td>
            `;
            
            tr.addEventListener('click', () => {
                document.querySelectorAll('#audit-txs-body tr').forEach(r => r.classList.remove('selected-tx-row'));
                tr.classList.add('selected-tx-row');
                
                const txHash = evt.transactionHash;
                document.getElementById('audit-selected-tx').value = txHash;
                document.getElementById('audit-selected-ciphertext').value = c_key_hex;
                document.getElementById('audit-selected-ciphertext').dataset.encryptedData = evt.args.encryptedAuditData;
                
                document.getElementById('input-ciphertext').value = c_key_hex;
                
                // Load previously collected shares for this transaction from localStorage
                collectedDecryptionShares = getCollectedShares(txHash);
                updateSharesPoolUI();
                updateAuditSharesPoolUI();
                
                if (currentAuditorIndex !== -1 && mySkShareHex) {
                    document.getElementById('btn-audit-gen-share').disabled = false;
                } else {
                    document.getElementById('btn-audit-gen-share').disabled = true;
                }
                
                // If we already have 3 shares, enable the decrypt button
                if (collectedDecryptionShares.length >= 3) {
                    document.getElementById('btn-audit-decrypt').disabled = false;
                } else {
                    document.getElementById('btn-audit-decrypt').disabled = true;
                }
                document.getElementById('compliance-result-output').classList.add('hidden');
                
                showToast("已选中交易，请开始收集局部份额进行解密", "info");
            });
            
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error("Query transact events failed:", err);
        showToast("检索交易日志失败: " + err.message, "error");
    }
}

// Compute auditor's decryption share for selected transaction
function auditComputeShare() {
    const ciphertext = document.getElementById('audit-selected-ciphertext').value;
    const txHash = document.getElementById('audit-selected-tx').value;
    if (!ciphertext || !txHash) {
        showToast("请先在左侧列表中选择一笔隐私交易！", "error");
        return;
    }
    const nodeId = currentAuditorIndex !== -1 ? currentAuditorIndex + 1 : 1;
    if (!mySkShareHex) {
        showToast(`本地内存中未找到节点 ${nodeId} 的私钥碎片！请先执行 Step 3 (拉取并聚合私钥碎片)。`, "error");
        return;
    }

    try {
        const sharePointHex = wasm_decrypt_share(ciphertext, mySkShareHex, nodeId);
        
        // Reload shares from localStorage first to prevent overwriting concurrently gathered shares
        collectedDecryptionShares = getCollectedShares(txHash);
        
        const index = collectedDecryptionShares.findIndex(s => s.node_id === nodeId);
        const newShare = { node_id: nodeId, share_point_hex: sharePointHex };
        
        if (index !== -1) {
            collectedDecryptionShares[index] = newShare;
        } else {
            collectedDecryptionShares.push(newShare);
        }
        
        saveCollectedShares(txHash, collectedDecryptionShares);
        
        updateSharesPoolUI();
        updateAuditSharesPoolUI();
        showToast(`审计节点 ${nodeId} 的局部解密份额计算成功并保存！`, "success");
        
        if (collectedDecryptionShares.length >= 3) {
            document.getElementById('btn-audit-decrypt').disabled = false;
        }
    } catch (err) {
        console.error("Gen share failed:", err);
        showToast("计算局部解密份额失败: " + err, "error");
    }
}

function updateAuditSharesPoolUI() {
    const container = document.getElementById('audit-shares-pool');
    container.innerHTML = "";

    if (collectedDecryptionShares.length === 0) {
        container.innerHTML = `<div class="empty-shares">暂未收集到解密份额，请各审计员切换钱包账户点击上方按钮生成。</div>`;
        return;
    }

    collectedDecryptionShares.forEach(share => {
        const badge = document.createElement('div');
        badge.className = "share-badge";
        badge.innerHTML = `
            <span class="share-node-label">审计节点 ${share.node_id}</span>
            <span class="mono-text font-small">${share.share_point_hex.slice(0, 24)}...</span>
        `;
        container.appendChild(badge);
    });
}

// Perform Lagrange threshold aggregation and decrypt encryptedAuditData
async function auditDecryptAndVerify() {
    const ciphertext = document.getElementById('audit-selected-ciphertext').value;
    const encryptedData = document.getElementById('audit-selected-ciphertext').dataset.encryptedData;
    
    if (collectedDecryptionShares.length < 3) {
        showToast("解密需要至少 3 个节点的解密份额！", "error");
        return;
    }

    showLoading("聚合解密份额中...");
    
    setTimeout(async () => {
        try {
            const sharesJson = JSON.stringify(collectedDecryptionShares);
            const decryptedSymKey = wasm_threshold_decrypt(ciphertext, sharesJson);
            
            let auditorCiphertext = encryptedData;
            try {
                const cleanHex = encryptedData.startsWith("0x") ? encryptedData.slice(2) : encryptedData;
                const rawPayloadString = new TextDecoder().decode(new Uint8Array(cleanHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))));
                const payloadObj = JSON.parse(rawPayloadString);
                if (payloadObj && payloadObj.auditor) {
                    auditorCiphertext = payloadObj.auditor;
                }
            } catch (e) {
                // Fallback for legacy raw AES ciphertexts
            }
            
            const decryptedJsonStr = await decryptWithSymKey(auditorCiphertext, decryptedSymKey);
            const details = JSON.parse(decryptedJsonStr);
            
            document.getElementById('res-sender-addr').innerText = details.sender;
            document.getElementById('res-recipient-addr').innerText = details.recipient;
            document.getElementById('res-amount').innerText = `${details.amount.toFixed(2)} MCK`;
            
            const conclusionBadge = document.getElementById('res-conclusion');
            conclusionBadge.innerText = details.conclusion;
            
            if (details.conclusion.includes("警报") || details.conclusion.includes("异常")) {
                conclusionBadge.style.background = "rgba(239, 68, 68, 0.15)";
                conclusionBadge.style.color = "#FCA5A5";
                conclusionBadge.style.borderColor = "rgba(239, 68, 68, 0.3)";
            } else {
                conclusionBadge.style.background = "rgba(16, 185, 129, 0.15)";
                conclusionBadge.style.color = "#34D399";
                conclusionBadge.style.borderColor = "rgba(16, 185, 129, 0.3)";
            }
            
            document.getElementById('compliance-result-output').classList.remove('hidden');
            showToast("合规审计密文明细解析成功！交易真实内容已还原。", "success");
        } catch (err) {
            console.error("Auditing decryption failed:", err);
            showToast("门限合规审计解密失败: " + err, "error");
        } finally {
            hideLoading();
        }
    }, 200);
}

// Helpers for persisting collected decryption shares across MetaMask account switch reloads
function getCollectedShares(txHash) {
    if (!txHash) return [];
    const key = `decryption_shares_${txHash.toLowerCase()}`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
}

function saveCollectedShares(txHash, shares) {
    if (!txHash) return;
    const key = `decryption_shares_${txHash.toLowerCase()}`;
    localStorage.setItem(key, JSON.stringify(shares));
}


