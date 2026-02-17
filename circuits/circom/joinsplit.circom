pragma circom 2.0.0;

include "merkleTree.circom";
include "circomlib/circuits/poseidon.circom";

template JoinSplit(levels) {
    // Public Inputs
    signal input root;
    signal input nullifier1;
    signal input nullifier2;
    signal input commitment1;
    signal input commitment2;
    signal input publicAmount;
    signal input fee;

    // Private Inputs
    signal input inAmount1;
    signal input inSecret1;
    signal input inBlinding1;
    signal input inPathIndices1[levels];
    signal input inPathElements1[levels];

    signal input inAmount2;
    signal input inSecret2;
    signal input inBlinding2;
    signal input inPathIndices2[levels];
    signal input inPathElements2[levels];

    signal input outAmount1;
    signal input outSecret1;
    signal input outBlinding1;

    signal input outAmount2;
    signal input outSecret2;
    signal input outBlinding2;

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
}

// Tree height 20
component main {public [root, nullifier1, nullifier2, commitment1, commitment2, publicAmount, fee]} = JoinSplit(20);
