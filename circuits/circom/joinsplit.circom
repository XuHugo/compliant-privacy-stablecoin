pragma circom 2.0.0;

include "merkleTree.circom";
include "circomlib/circuits/poseidon.circom";

template JoinSplit(levels) {
    // Public Inputs
    signal input root;
    signal input cleanTreeRoot;
    signal input nullifier1;
    signal input nullifier2;
    signal input commitment1;
    signal input commitment2;
    signal input publicAmount;
    signal input fee;
    signal input recipient;
    signal input relayer;
    signal input auditCiphertext[4];

    // Private Inputs
    signal input symKey;
    signal input inAmount1;
    signal input inSecret1;
    signal input inBlinding1;
    signal input inPathIndices1[levels];
    signal input inPathElements1[levels];
    signal input inCleanPathIndices1[levels];
    signal input inCleanPathElements1[levels];

    signal input inAmount2;
    signal input inSecret2;
    signal input inBlinding2;
    signal input inPathIndices2[levels];
    signal input inPathElements2[levels];
    signal input inCleanPathIndices2[levels];
    signal input inCleanPathElements2[levels];

    signal input outAmount1;
    signal input outSecret1;
    signal input outBlinding1;

    signal input outAmount2;
    signal input outSecret2;
    signal input outBlinding2;

    // 0. MEV Protection (Bind recipient and relayer)
    signal dummyRecipient;
    dummyRecipient <== recipient * recipient;
    signal dummyRelayer;
    dummyRelayer <== relayer * relayer;

    // 1. Verify Balance Conservation
    // in1 + in2 + publicAmount = out1 + out2 + fee
    signal inputSum;
    inputSum <== inAmount1 + inAmount2 + publicAmount;
    
    signal outputSum;
    outputSum <== outAmount1 + outAmount2 + fee;

    inputSum === outputSum;

    // 2. Verify Commitment 1 and Merkle Proof 1
    
    component c1 = Poseidon(3);
    c1.inputs[0] <== inAmount1;
    c1.inputs[1] <== inSecret1;
    c1.inputs[2] <== inBlinding1;

    component tree1 = MerkleTreeChecker(levels);
    tree1.leaf <== c1.out;
    tree1.root <== root;
    for (var i = 0; i < levels; i++) {
        tree1.pathElements[i] <== inPathElements1[i];
        tree1.pathIndices[i] <== inPathIndices1[i];
    }

    // Verify POI (Clean Tree) for Commitment 1
    component cleanTree1 = MerkleTreeChecker(levels);
    cleanTree1.leaf <== c1.out;
    cleanTree1.root <== cleanTreeRoot;
    for (var i = 0; i < levels; i++) {
        cleanTree1.pathElements[i] <== inCleanPathElements1[i];
        cleanTree1.pathIndices[i] <== inCleanPathIndices1[i];
    }

    // 3. Verify Nullifier 1
    
    var index1 = 0;
    for (var i = 0; i < levels; i++) {
        index1 += inPathIndices1[i] * (2 ** i);
    }

    component n1 = Poseidon(2);
    n1.inputs[0] <== inSecret1;
    n1.inputs[1] <== index1;
    n1.out === nullifier1;

    // 4. Verify Commitment 2 and Merkle Proof 2
    component c2 = Poseidon(3);
    c2.inputs[0] <== inAmount2;
    c2.inputs[1] <== inSecret2;
    c2.inputs[2] <== inBlinding2;

    component tree2 = MerkleTreeChecker(levels);
    tree2.leaf <== c2.out;
    tree2.root <== root;
    for (var i = 0; i < levels; i++) {
        tree2.pathElements[i] <== inPathElements2[i];
        tree2.pathIndices[i] <== inPathIndices2[i];
    }

    // Verify POI (Clean Tree) for Commitment 2
    component cleanTree2 = MerkleTreeChecker(levels);
    cleanTree2.leaf <== c2.out;
    cleanTree2.root <== cleanTreeRoot;
    for (var i = 0; i < levels; i++) {
        cleanTree2.pathElements[i] <== inCleanPathElements2[i];
        cleanTree2.pathIndices[i] <== inCleanPathIndices2[i];
    }

    // 5. Verify Nullifier 2
    var index2 = 0;
    for (var i = 0; i < levels; i++) {
        index2 += inPathIndices2[i] * (2 ** i);
    }

    component n2 = Poseidon(2);
    n2.inputs[0] <== inSecret2;
    n2.inputs[1] <== index2;
    n2.out === nullifier2;

    // 6. Verify Output Commitment 1
    component outC1 = Poseidon(3);
    outC1.inputs[0] <== outAmount1;
    outC1.inputs[1] <== outSecret1;
    outC1.inputs[2] <== outBlinding1;
    outC1.out === commitment1;

    // 7. Verify Output Commitment 2
    component outC2 = Poseidon(3);
    outC2.inputs[0] <== outAmount2;
    outC2.inputs[1] <== outSecret2;
    outC2.inputs[2] <== outBlinding2;
    outC2.out === commitment2;

    // 8. Phase 3: Poseidon Symmetric Encryption for Audit (Dual Commitment)
    // Encrypting: [outAmount1, outAmount2, recipient, relayer]
    component ks1 = Poseidon(2);
    ks1.inputs[0] <== symKey;
    ks1.inputs[1] <== 0;
    auditCiphertext[0] === outAmount1 + ks1.out;

    component ks2 = Poseidon(2);
    ks2.inputs[0] <== symKey;
    ks2.inputs[1] <== 1;
    auditCiphertext[1] === outAmount2 + ks2.out;

    component ks3 = Poseidon(2);
    ks3.inputs[0] <== symKey;
    ks3.inputs[1] <== 2;
    auditCiphertext[2] === recipient + ks3.out;

    component ks4 = Poseidon(2);
    ks4.inputs[0] <== symKey;
    ks4.inputs[1] <== 3;
    auditCiphertext[3] === relayer + ks4.out;
}

// Tree height 20
component main {public [root, cleanTreeRoot, nullifier1, nullifier2, commitment1, commitment2, publicAmount, fee, recipient, relayer, auditCiphertext]} = JoinSplit(20);
