// SPDX-License-Identifier: GPL-3.0
/*
    Copyright 2021 0KIMS association.

    This file is generated with [snarkJS](https://github.com/iden3/snarkjs).

    snarkJS is a free software: you can redistribute it and/or modify it
    under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    snarkJS is distributed in the hope that it will be useful, but WITHOUT
    ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
    or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public
    License for more details.

    You should have received a copy of the GNU General Public License
    along with snarkJS. If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity >=0.7.0 <0.9.0;

contract Groth16Verifier {
    // Scalar field size
    uint256 constant r    = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    // Base field size
    uint256 constant q   = 21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // Verification Key data
    uint256 constant alphax  = 11579354143278146275482193188886212979610445127228714027246752886541709829490;
    uint256 constant alphay  = 16391648284201407129398983587268849222076408982963178982014334818433598299969;
    uint256 constant betax1  = 4567352373131478216811876030372223199981173951427505108335121868553237566462;
    uint256 constant betax2  = 8221002069564407865894966475974289451113015201692100171489035851455351275631;
    uint256 constant betay1  = 19165991364155917905261521062677110246022908408466276331219356350148753825475;
    uint256 constant betay2  = 17081596623234203537666012399301270143883793214399410846370634723421732836710;
    uint256 constant gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 constant gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 constant gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 constant gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
    uint256 constant deltax1 = 159120059506027502762098611101504481291133962013636123742804998644624752087;
    uint256 constant deltax2 = 3147200084201841836129301660835846327854451716053001689603332818094553066389;
    uint256 constant deltay1 = 20614050428923732552917315257157842243440990058482202389726210640101325396073;
    uint256 constant deltay2 = 18933554444774977834686736130549751476309366096636069365377930103801049905936;

    
    uint256 constant IC0x = 1157823809314847234595383538748850713823318268800396561905040445880437350426;
    uint256 constant IC0y = 8836672223311286766522178386339109023255810252260122666057892018994701064729;
    
    uint256 constant IC1x = 4718950555545658728854621296286313040788197640006928441869853762084217757989;
    uint256 constant IC1y = 2002148579073018825746284031199122107348857963517980501373752608741431419132;
    
    uint256 constant IC2x = 19937229909235742929037162186168938062199053070582915303978431413298841591998;
    uint256 constant IC2y = 2539725982565646204336235654971983416936661632823393955451462431121993944349;
    
    uint256 constant IC3x = 8627476599822052392103202559872335809962734927430314785453943920421749974169;
    uint256 constant IC3y = 13857717881554378567944619143190729309041859386540078576191128617980379810233;
    
    uint256 constant IC4x = 21762738151824887984925668589598488502199213011387783787365250753436573613887;
    uint256 constant IC4y = 6744781870403670648561380301428387577886233683258055422917997492979260408589;
    
    uint256 constant IC5x = 10067946245095350161219532350539802190709841575555210889640047015489989851995;
    uint256 constant IC5y = 9079177534215114323310384454868307306803326739453262523961587788401992019384;
    
    uint256 constant IC6x = 19103661524594150507755923777458647940016390686020179969030683616869531534388;
    uint256 constant IC6y = 2063448469262103789663253377845669199093354697406732448240164481627934881316;
    
    uint256 constant IC7x = 10050902277527721814669844553229065807468857478596021217514953339289670885957;
    uint256 constant IC7y = 5123256677662016871523385536937601082564642926876914593345307223440590397233;
    
    uint256 constant IC8x = 20912369844919195745184796831918370233484035003588263704364916953394660767404;
    uint256 constant IC8y = 4500582406566958594515326672469723987072944159303945619634675172552995247044;
    
    uint256 constant IC9x = 21495571119693873608761363447294097175947171875367046312526894519136560665611;
    uint256 constant IC9y = 13397525709780060132928442039905131016420227204136815176971707574762116587086;
    
    uint256 constant IC10x = 17577397575081116442381410635909840052867648068898450297227749413391324568949;
    uint256 constant IC10y = 21361323213856183599356418192107962553368892832358364772193709670804708756171;
    
    uint256 constant IC11x = 18648449475490690311832418809962536951188045903646770778580232710276227177014;
    uint256 constant IC11y = 20039729535593397345702702431404788477137240892182003099295940223022450517940;
    
    uint256 constant IC12x = 8510564736185443690128534249452774656404715950815647648142320732014671675109;
    uint256 constant IC12y = 20150949268798264367769031978171506446407300566018207620805961490821403074347;
    
    uint256 constant IC13x = 8651662666877359219430275921436292473629390023648209202314467504094675649501;
    uint256 constant IC13y = 16571723074280587218799788696357173528431377651859944998036744018371859283136;
    
    uint256 constant IC14x = 12793521693604445045591396176151687426579004771850079232937261214509658555792;
    uint256 constant IC14y = 21641032715508623387323373278405438075515731746004693335115633516498271952565;
    
 
    // Memory data
    uint16 constant pVk = 0;
    uint16 constant pPairing = 128;

    uint16 constant pLastMem = 896;

    function verifyProof(uint[2] calldata _pA, uint[2][2] calldata _pB, uint[2] calldata _pC, uint[14] calldata _pubSignals) public view returns (bool) {
        assembly {
            function checkField(v) {
                if iszero(lt(v, r)) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }
            
            // G1 function to multiply a G1 value(x,y) to value in an address
            function g1_mulAccC(pR, x, y, s) {
                let success
                let mIn := mload(0x40)
                mstore(mIn, x)
                mstore(add(mIn, 32), y)
                mstore(add(mIn, 64), s)

                success := staticcall(sub(gas(), 2000), 7, mIn, 96, mIn, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }

                mstore(add(mIn, 64), mload(pR))
                mstore(add(mIn, 96), mload(add(pR, 32)))

                success := staticcall(sub(gas(), 2000), 6, mIn, 128, pR, 64)

                if iszero(success) {
                    mstore(0, 0)
                    return(0, 0x20)
                }
            }

            function checkPairing(pA, pB, pC, pubSignals, pMem) -> isOk {
                let _pPairing := add(pMem, pPairing)
                let _pVk := add(pMem, pVk)

                mstore(_pVk, IC0x)
                mstore(add(_pVk, 32), IC0y)

                // Compute the linear combination vk_x
                
                g1_mulAccC(_pVk, IC1x, IC1y, calldataload(add(pubSignals, 0)))
                
                g1_mulAccC(_pVk, IC2x, IC2y, calldataload(add(pubSignals, 32)))
                
                g1_mulAccC(_pVk, IC3x, IC3y, calldataload(add(pubSignals, 64)))
                
                g1_mulAccC(_pVk, IC4x, IC4y, calldataload(add(pubSignals, 96)))
                
                g1_mulAccC(_pVk, IC5x, IC5y, calldataload(add(pubSignals, 128)))
                
                g1_mulAccC(_pVk, IC6x, IC6y, calldataload(add(pubSignals, 160)))
                
                g1_mulAccC(_pVk, IC7x, IC7y, calldataload(add(pubSignals, 192)))
                
                g1_mulAccC(_pVk, IC8x, IC8y, calldataload(add(pubSignals, 224)))
                
                g1_mulAccC(_pVk, IC9x, IC9y, calldataload(add(pubSignals, 256)))
                
                g1_mulAccC(_pVk, IC10x, IC10y, calldataload(add(pubSignals, 288)))
                
                g1_mulAccC(_pVk, IC11x, IC11y, calldataload(add(pubSignals, 320)))
                
                g1_mulAccC(_pVk, IC12x, IC12y, calldataload(add(pubSignals, 352)))
                
                g1_mulAccC(_pVk, IC13x, IC13y, calldataload(add(pubSignals, 384)))
                
                g1_mulAccC(_pVk, IC14x, IC14y, calldataload(add(pubSignals, 416)))
                

                // -A
                mstore(_pPairing, calldataload(pA))
                mstore(add(_pPairing, 32), mod(sub(q, calldataload(add(pA, 32))), q))

                // B
                mstore(add(_pPairing, 64), calldataload(pB))
                mstore(add(_pPairing, 96), calldataload(add(pB, 32)))
                mstore(add(_pPairing, 128), calldataload(add(pB, 64)))
                mstore(add(_pPairing, 160), calldataload(add(pB, 96)))

                // alpha1
                mstore(add(_pPairing, 192), alphax)
                mstore(add(_pPairing, 224), alphay)

                // beta2
                mstore(add(_pPairing, 256), betax1)
                mstore(add(_pPairing, 288), betax2)
                mstore(add(_pPairing, 320), betay1)
                mstore(add(_pPairing, 352), betay2)

                // vk_x
                mstore(add(_pPairing, 384), mload(add(pMem, pVk)))
                mstore(add(_pPairing, 416), mload(add(pMem, add(pVk, 32))))


                // gamma2
                mstore(add(_pPairing, 448), gammax1)
                mstore(add(_pPairing, 480), gammax2)
                mstore(add(_pPairing, 512), gammay1)
                mstore(add(_pPairing, 544), gammay2)

                // C
                mstore(add(_pPairing, 576), calldataload(pC))
                mstore(add(_pPairing, 608), calldataload(add(pC, 32)))

                // delta2
                mstore(add(_pPairing, 640), deltax1)
                mstore(add(_pPairing, 672), deltax2)
                mstore(add(_pPairing, 704), deltay1)
                mstore(add(_pPairing, 736), deltay2)


                let success := staticcall(sub(gas(), 2000), 8, _pPairing, 768, _pPairing, 0x20)

                isOk := and(success, mload(_pPairing))
            }

            let pMem := mload(0x40)
            mstore(0x40, add(pMem, pLastMem))

            // Validate that all evaluations ∈ F
            
            checkField(calldataload(add(_pubSignals, 0)))
            
            checkField(calldataload(add(_pubSignals, 32)))
            
            checkField(calldataload(add(_pubSignals, 64)))
            
            checkField(calldataload(add(_pubSignals, 96)))
            
            checkField(calldataload(add(_pubSignals, 128)))
            
            checkField(calldataload(add(_pubSignals, 160)))
            
            checkField(calldataload(add(_pubSignals, 192)))
            
            checkField(calldataload(add(_pubSignals, 224)))
            
            checkField(calldataload(add(_pubSignals, 256)))
            
            checkField(calldataload(add(_pubSignals, 288)))
            
            checkField(calldataload(add(_pubSignals, 320)))
            
            checkField(calldataload(add(_pubSignals, 352)))
            
            checkField(calldataload(add(_pubSignals, 384)))
            
            checkField(calldataload(add(_pubSignals, 416)))
            

            // Validate all evaluations
            let isValid := checkPairing(_pA, _pB, _pC, _pubSignals, pMem)

            mstore(0, isValid)
             return(0, 0x20)
         }
     }
 }
