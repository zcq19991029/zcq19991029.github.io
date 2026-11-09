// ============================================================================
// 超级排位 · 完整标准网表（**自动生成，勿手改**）
//
// 生成命令：cd 接线仿真 && node build-super-nets.cjs
// 生成脚本：build-super-nets.cjs（口径和坑写在那里面，改数据前先读一遍）
//
// 这张表干什么：
//   judge(wires, circuit, { nets: SUPER_NETS['2.2'] }) —— 判学生连的线对不对。
//   网名 → 该等电位点上允许任意串接的端子集合（**位置无关**，只看端子字符串 ID）。
//
// 数据来源：每条电路的 BW（教材导线）按 net 分组，再用 answers[0].chains 覆盖写一遍，
//   口径同 practice.js:321-330 的 answerWires()。接法之间的网表内容实测一致，所以一份够用。
//
//   电路 | 网数 | 端子数 | BW 导线 | 接法 | chains 覆盖 | 靠 BW 补
//   2.1  | 14   | 31     | 17     | 2    | 0           | 14
//   2.2  | 17   | 47     | 30     | 3    | 0           | 17
//   2.3  | 19   | 51     | 32     | 3    | 0           | 19
//   2.4  | 25   | 66     | 41     | 3    | 0           | 25
//   2.5  | 25   | 68     | 43     | 3    | 0           | 25
//   2.6  | 27   | 70     | 43     | 3    | 0           | 27
//   E1   | 27   | 79     | 52     | 2    | 0           | 27
//   E2   | 34   | 96     | 62     | 2    | 0           | 34
//
// 不产网表的电路：
//   P：并联专项：parallel.js 是 12 道小题各自一份导线，没有单一标准答案。超级排位里 P 现阶段只做摆放、不做接线判分。
// ============================================================================

(function (W) {
  'use strict';

  W.SUPER_NETS = {
    "2.1": {
      "1": [
        "FR.t4",
        "FU2.b"
      ],
      "2": [
        "FR.b4",
        "SB1.i"
      ],
      "3": [
        "KM1.t3",
        "SB1.o",
        "SB2.i"
      ],
      "4": [
        "KM1.b3",
        "KM1.t5",
        "SB2.o"
      ],
      "N": [
        "KM1.b5",
        "QF.b3"
      ],
      "U11": [
        "FU1.t0",
        "QF.b0"
      ],
      "U12": [
        "FU1.b0",
        "KM1.t0"
      ],
      "U13": [
        "FR.t0",
        "KM1.b0"
      ],
      "V11": [
        "FU1.t1",
        "QF.b1"
      ],
      "V12": [
        "FU1.b1",
        "KM1.t1"
      ],
      "V13": [
        "FR.t1",
        "KM1.b1"
      ],
      "W11": [
        "FU1.t2",
        "FU2.t",
        "QF.b2"
      ],
      "W12": [
        "FU1.b2",
        "KM1.t2"
      ],
      "W13": [
        "FR.t2",
        "KM1.b2"
      ]
    },
    "2.2": {
      "1": [
        "FR.t4",
        "FU2.b"
      ],
      "2": [
        "FR.b4",
        "SB1.i"
      ],
      "3": [
        "KM1.t3",
        "KM2.t3",
        "SB1.o",
        "SB2.i",
        "SB3.i"
      ],
      "4": [
        "KM1.b3",
        "KM2.t4",
        "SB2.o"
      ],
      "5": [
        "KM1.t5",
        "KM2.b4"
      ],
      "6": [
        "KM1.t4",
        "KM2.b3",
        "SB3.o"
      ],
      "7": [
        "KM1.b4",
        "KM2.t5"
      ],
      "N": [
        "KM1.b5",
        "KM2.b5",
        "QF.b3"
      ],
      "U11": [
        "FU1.t0",
        "QF.b0"
      ],
      "U12": [
        "FU1.b0",
        "KM1.t0",
        "KM2.t0"
      ],
      "U13": [
        "FR.t0",
        "KM1.b0",
        "KM2.b2"
      ],
      "V11": [
        "FU1.t1",
        "QF.b1"
      ],
      "V12": [
        "FU1.b1",
        "KM1.t1",
        "KM2.t1"
      ],
      "V13": [
        "FR.t1",
        "KM1.b1",
        "KM2.b1"
      ],
      "W11": [
        "FU1.t2",
        "FU2.t",
        "QF.b2"
      ],
      "W12": [
        "FU1.b2",
        "KM1.t2",
        "KM2.t2"
      ],
      "W13": [
        "FR.t2",
        "KM1.b2",
        "KM2.b0"
      ]
    },
    "2.3": {
      "1": [
        "FR.t4",
        "FU2.b"
      ],
      "2": [
        "FR.b4",
        "SB1.i"
      ],
      "3": [
        "SB1.o",
        "SB2.ci",
        "SB3.ci"
      ],
      "4": [
        "KM1.t3",
        "SB2.ai",
        "SB3.co"
      ],
      "5": [
        "KM1.b3",
        "KM2.t4",
        "SB2.ao"
      ],
      "6": [
        "KM1.t5",
        "KM2.b4"
      ],
      "7": [
        "KM2.t3",
        "SB2.co",
        "SB3.ai"
      ],
      "8": [
        "KM1.t4",
        "KM2.b3",
        "SB3.ao"
      ],
      "9": [
        "KM1.b4",
        "KM2.t5"
      ],
      "N": [
        "KM1.b5",
        "KM2.b5",
        "QF.b3"
      ],
      "U11": [
        "FU1.t0",
        "QF.b0"
      ],
      "U12": [
        "FU1.b0",
        "KM1.t0",
        "KM2.t0"
      ],
      "U13": [
        "FR.t0",
        "KM1.b0",
        "KM2.b2"
      ],
      "V11": [
        "FU1.t1",
        "QF.b1"
      ],
      "V12": [
        "FU1.b1",
        "KM1.t1",
        "KM2.t1"
      ],
      "V13": [
        "FR.t1",
        "KM1.b1",
        "KM2.b1"
      ],
      "W11": [
        "FU1.t2",
        "FU2.t",
        "QF.b2"
      ],
      "W12": [
        "FU1.b2",
        "KM1.t2",
        "KM2.t2"
      ],
      "W13": [
        "FR.t2",
        "KM1.b2",
        "KM2.b0"
      ]
    },
    "2.4": {
      "1": [
        "FR.t4",
        "FU2.b"
      ],
      "2": [
        "FR.b4",
        "SB1.i"
      ],
      "3": [
        "KM1.t3",
        "SB1.o",
        "SB2.i"
      ],
      "4": [
        "KM1.b3",
        "KM1.t5",
        "KM2.t3",
        "SB2.o",
        "SB3.ai",
        "SB3.ci"
      ],
      "5": [
        "KM2.t4",
        "SB3.co"
      ],
      "6": [
        "KM2.b4",
        "KM3.t5"
      ],
      "7": [
        "KM2.b3",
        "KM3.t4",
        "SB3.ao"
      ],
      "8": [
        "KM2.t5",
        "KM3.b4"
      ],
      "N": [
        "KM1.b5",
        "KM2.b5",
        "KM3.b5",
        "QF.b3"
      ],
      "U1": [
        "FR.b0",
        "M.t0"
      ],
      "U11": [
        "FU1.t0",
        "QF.b0"
      ],
      "U12": [
        "FU1.b0",
        "KM1.t0"
      ],
      "U13": [
        "FR.t0",
        "KM1.b0",
        "KM2.t0"
      ],
      "U2": [
        "KM2.b1",
        "KM3.t1",
        "M.t4"
      ],
      "V1": [
        "FR.b1",
        "M.t1"
      ],
      "V11": [
        "FU1.t1",
        "QF.b1"
      ],
      "V12": [
        "FU1.b1",
        "KM1.t1"
      ],
      "V13": [
        "FR.t1",
        "KM1.b1",
        "KM2.t1"
      ],
      "V2": [
        "KM2.b2",
        "KM3.t2",
        "M.t5"
      ],
      "W1": [
        "FR.b2",
        "M.t2"
      ],
      "W11": [
        "FU1.t2",
        "FU2.t",
        "QF.b2"
      ],
      "W12": [
        "FU1.b2",
        "KM1.t2"
      ],
      "W13": [
        "FR.t2",
        "KM1.b2",
        "KM2.t2"
      ],
      "W2": [
        "KM2.b0",
        "KM3.t0",
        "M.t3"
      ],
      "Y": [
        "KM3.b0",
        "KM3.b1",
        "KM3.b2"
      ]
    },
    "2.5": {
      "1": [
        "FR.t4",
        "FU2.b"
      ],
      "2": [
        "FR.b4",
        "SB1.i"
      ],
      "3": [
        "KM1.t3",
        "SB1.o",
        "SB2.i"
      ],
      "4": [
        "KM1.b3",
        "KM1.t5",
        "KM2.t3",
        "KM2.t4",
        "KT.ni",
        "SB2.o"
      ],
      "5": [
        "KM2.b3",
        "KM3.t4",
        "KT.no"
      ],
      "6": [
        "KM2.t5",
        "KM3.b4"
      ],
      "7": [
        "KM2.b4",
        "KT.a1",
        "KT.ci"
      ],
      "8": [
        "KM3.t5",
        "KT.co"
      ],
      "N": [
        "KM1.b5",
        "KM2.b5",
        "KM3.b5",
        "KT.a2",
        "QF.b3"
      ],
      "U1": [
        "FR.b0",
        "M.t0"
      ],
      "U11": [
        "FU1.t0",
        "QF.b0"
      ],
      "U12": [
        "FU1.b0",
        "KM1.t0",
        "KM2.t0"
      ],
      "U13": [
        "FR.t0",
        "KM1.b0"
      ],
      "U2": [
        "KM2.b1",
        "KM3.t1",
        "M.t4"
      ],
      "V1": [
        "FR.b1",
        "M.t1"
      ],
      "V11": [
        "FU1.t1",
        "QF.b1"
      ],
      "V12": [
        "FU1.b1",
        "KM1.t1",
        "KM2.t1"
      ],
      "V13": [
        "FR.t1",
        "KM1.b1"
      ],
      "V2": [
        "KM2.b2",
        "KM3.t2",
        "M.t5"
      ],
      "W1": [
        "FR.b2",
        "M.t2"
      ],
      "W11": [
        "FU1.t2",
        "FU2.t",
        "QF.b2"
      ],
      "W12": [
        "FU1.b2",
        "KM1.t2",
        "KM2.t2"
      ],
      "W13": [
        "FR.t2",
        "KM1.b2"
      ],
      "W2": [
        "KM2.b0",
        "KM3.t0",
        "M.t3"
      ],
      "Y": [
        "KM3.b0",
        "KM3.b1",
        "KM3.b2"
      ]
    },
    "2.6": {
      "1": [
        "FR.t4",
        "FU2.b"
      ],
      "2": [
        "FR.b4",
        "SB1.i"
      ],
      "3": [
        "KM1.t3",
        "SB1.o",
        "SB2.ai",
        "SB2.ci"
      ],
      "4": [
        "KM1.b3",
        "SB2.ao",
        "SB3.ci"
      ],
      "5": [
        "KM2.t4",
        "SB3.co"
      ],
      "6": [
        "KM2.b4",
        "KM3.t4"
      ],
      "7": [
        "KM1.t5",
        "KM3.b4"
      ],
      "8": [
        "KM2.t3",
        "SB2.co",
        "SB3.ai"
      ],
      "9": [
        "KM2.b3",
        "KM3.t3"
      ],
      "10": [
        "KM1.t4",
        "KM3.b3",
        "SB3.ao"
      ],
      "11": [
        "KM1.b4",
        "KM2.t5",
        "KM3.t5"
      ],
      "N": [
        "KM1.b5",
        "KM2.b5",
        "KM3.b5",
        "QF.b3"
      ],
      "U1": [
        "KM1.b0",
        "KM3.b0",
        "M.t0"
      ],
      "U11": [
        "FU1.t0",
        "QF.b0"
      ],
      "U12": [
        "FR.t0",
        "FU1.b0"
      ],
      "U13": [
        "FR.b0",
        "KM1.t0",
        "KM2.t0"
      ],
      "U2": [
        "KM2.b0",
        "M.t3"
      ],
      "V1": [
        "KM1.b1",
        "KM3.t0",
        "KM3.t1",
        "M.t1"
      ],
      "V11": [
        "FU1.t1",
        "QF.b1"
      ],
      "V12": [
        "FR.t1",
        "FU1.b1"
      ],
      "V13": [
        "FR.b1",
        "KM1.t1",
        "KM2.t2"
      ],
      "V2": [
        "KM2.b1",
        "M.t4"
      ],
      "W1": [
        "KM1.b2",
        "KM3.b1",
        "M.t2"
      ],
      "W11": [
        "FU1.t2",
        "FU2.t",
        "QF.b2"
      ],
      "W12": [
        "FR.t2",
        "FU1.b2"
      ],
      "W13": [
        "FR.b2",
        "KM1.t2",
        "KM2.t1"
      ],
      "W2": [
        "KM2.b2",
        "M.t5"
      ]
    },
    "E1": {
      "1": [
        "FR.t4",
        "FU2.b"
      ],
      "2": [
        "FU2b.b",
        "KM1.b5",
        "KM2.b5",
        "KM3.b5",
        "KT.a2"
      ],
      "3": [
        "FR.b4",
        "KM3.t3",
        "KM3.t4",
        "SB1.ai"
      ],
      "5": [
        "KM3.b4",
        "SB1.ci"
      ],
      "7": [
        "KM1.t3",
        "KM2.t3",
        "SB1.co",
        "SB2.ai",
        "SB3.ai"
      ],
      "9": [
        "KM1.b3",
        "SB2.ao",
        "SB3.ci"
      ],
      "11": [
        "KM2.t4",
        "SB3.co"
      ],
      "13": [
        "KM1.t5",
        "KM2.b4"
      ],
      "15": [
        "KM2.b3",
        "SB2.ci",
        "SB3.ao"
      ],
      "17": [
        "KM1.t4",
        "SB2.co"
      ],
      "19": [
        "KM1.b4",
        "KM2.t5"
      ],
      "21": [
        "KM3.b3",
        "KT.a1",
        "KT.ci",
        "SB1.ao"
      ],
      "23": [
        "KM1.t6",
        "KT.co"
      ],
      "25": [
        "KM1.b6",
        "KM2.t6"
      ],
      "27": [
        "KM2.b6",
        "KM3.t5"
      ],
      "N": [
        "QF.b3",
        "R.t"
      ],
      "U11": [
        "FU1.t0",
        "QF.b0"
      ],
      "U12": [
        "FU1.b0",
        "FU2.t",
        "KM1.t0",
        "KM2.t0",
        "KM3.t1",
        "KM3.t2"
      ],
      "U13": [
        "FR.t0",
        "KM1.b0",
        "KM2.b2",
        "KM3.b0"
      ],
      "U14": [
        "KM3.t0",
        "VD.b"
      ],
      "U15": [
        "R.b",
        "VD.t"
      ],
      "V11": [
        "FU1.t1",
        "QF.b1"
      ],
      "V12": [
        "FU1.b1",
        "FU2b.t",
        "KM1.t1",
        "KM2.t1"
      ],
      "V13": [
        "FR.t1",
        "KM1.b1",
        "KM2.b1",
        "KM3.b1"
      ],
      "W11": [
        "FU1.t2",
        "QF.b2"
      ],
      "W12": [
        "FU1.b2",
        "KM1.t2",
        "KM2.t2"
      ],
      "W13": [
        "FR.t2",
        "KM1.b2",
        "KM2.b0",
        "KM3.b2"
      ]
    },
    "E2": {
      "201": [
        "FU2.b",
        "KM4.t1"
      ],
      "202": [
        "KM4.b1",
        "VD.t0"
      ],
      "203": [
        "KM4.t2",
        "VD.b0"
      ],
      "000": [
        "KM1.b5",
        "KM2.b5",
        "KM3.b5",
        "KM4.b5",
        "KT.b2",
        "TC.b1"
      ],
      "001": [
        "FU5.t",
        "TC.b0"
      ],
      "002": [
        "FU5.b",
        "KT.t0",
        "KT.t1",
        "SQ1.t0",
        "SQ1.t1"
      ],
      "003": [
        "KT.b0",
        "SB1.i",
        "SB3.i",
        "SQ1.b0"
      ],
      "004": [
        "KM1.t3",
        "SB1.o",
        "SB2.i"
      ],
      "005": [
        "KM1.b3",
        "KM4.t4",
        "SB2.o"
      ],
      "006": [
        "KM1.t5",
        "KM2.t5",
        "KM4.b4"
      ],
      "007": [
        "KM3.t5",
        "SB3.o"
      ],
      "012": [
        "KM1.t6",
        "SQ1.b1"
      ],
      "013": [
        "KM1.b6",
        "KM1.t4",
        "KM4.t6",
        "KT.b1"
      ],
      "014": [
        "KM1.b4",
        "KM2.t4"
      ],
      "015": [
        "KM2.b4",
        "KM4.t5"
      ],
      "016": [
        "KM4.b6",
        "KT.t2"
      ],
      "U11": [
        "FU1.t0",
        "KM1.t0",
        "KM4.t0",
        "QF.b0"
      ],
      "U12": [
        "KM1.b0",
        "KM2.t0",
        "KM4.b0",
        "M1.t0"
      ],
      "U13": [
        "KM2.b0",
        "QF2.t0"
      ],
      "U14": [
        "M2.t0",
        "QF2.b0"
      ],
      "U21": [
        "FU1.b0",
        "KM3.t0",
        "TC.t0"
      ],
      "U22": [
        "KM3.b0",
        "M3.t0"
      ],
      "V11": [
        "FU1.t1",
        "FU2.t",
        "KM1.t1",
        "QF.b1"
      ],
      "V12": [
        "KM1.b1",
        "KM2.t1",
        "KM4.t3",
        "M1.t1"
      ],
      "V13": [
        "KM2.b1",
        "QF2.t1"
      ],
      "V14": [
        "M2.t1",
        "QF2.b1"
      ],
      "V21": [
        "FU1.b1",
        "KM3.t1"
      ],
      "V22": [
        "KM3.b1",
        "M3.t1"
      ],
      "W11": [
        "FU1.t2",
        "KM1.t2",
        "QF.b2"
      ],
      "W12": [
        "KM1.b2",
        "KM2.t2",
        "KM4.b2",
        "KM4.b3",
        "M1.t2"
      ],
      "W13": [
        "KM2.b2",
        "QF2.t2"
      ],
      "W14": [
        "M2.t2",
        "QF2.b2"
      ],
      "W21": [
        "FU1.b2",
        "KM3.t2",
        "TC.t1"
      ],
      "W22": [
        "KM3.b2",
        "M3.t2"
      ]
    }
  };

  W.SUPER_NETS_META = {
    "2.1": {
      "nets": 14,
      "terms": 31,
      "bw": 17,
      "answers": 2,
      "fromBW": 14,
      "fromChains": 0,
      "src": "circuit21.js"
    },
    "2.2": {
      "nets": 17,
      "terms": 47,
      "bw": 30,
      "answers": 3,
      "fromBW": 17,
      "fromChains": 0,
      "src": "board.js + schematic.js + circuit22.js"
    },
    "2.3": {
      "nets": 19,
      "terms": 51,
      "bw": 32,
      "answers": 3,
      "fromBW": 19,
      "fromChains": 0,
      "src": "circuit23.js"
    },
    "2.4": {
      "nets": 25,
      "terms": 66,
      "bw": 41,
      "answers": 3,
      "fromBW": 25,
      "fromChains": 0,
      "src": "circuit24.js"
    },
    "2.5": {
      "nets": 25,
      "terms": 68,
      "bw": 43,
      "answers": 3,
      "fromBW": 25,
      "fromChains": 0,
      "src": "circuit25.js"
    },
    "2.6": {
      "nets": 27,
      "terms": 70,
      "bw": 43,
      "answers": 3,
      "fromBW": 27,
      "fromChains": 0,
      "src": "circuit26.js"
    },
    "E1": {
      "nets": 27,
      "terms": 79,
      "bw": 52,
      "answers": 2,
      "fromBW": 27,
      "fromChains": 0,
      "src": "circuitE1.js"
    },
    "E2": {
      "nets": 34,
      "terms": 96,
      "bw": 62,
      "answers": 2,
      "fromBW": 34,
      "fromChains": 0,
      "src": "circuitE2.js"
    }
  };

  W.SUPER_NETS_SKIP = {
    "P": "并联专项：parallel.js 是 12 道小题各自一份导线，没有单一标准答案。超级排位里 P 现阶段只做摆放、不做接线判分。"
  };
})(typeof window !== 'undefined' ? window : globalThis);
