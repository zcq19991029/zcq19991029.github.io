/*!
 * 华夏工具 · 排位身份卡「预设背景」（rank-bg.js）
 * ------------------------------------------------------------------
 * 12 套原创 CSS/SVG 背景，全部由渐变 + 内联 SVG 拼出，不引用任何网络图片、
 * 不依赖外部字体，单套 < 6KB。主程序给每名学生渲染一张横向身份卡
 * （约 16:5 ~ 20:9），背景在下、文字在上，另有一层深色遮罩由主程序叠。
 *
 * 提供的 API：
 *   window.RANK_BG_PRESETS  数组，每项 { k, name, css }
 *   window.rankBgCss(k)     预设键 → 可直接赋给 background 的字符串；
 *                           'none' / 空 / 未知键 → ''（调用方走默认底）
 *
 * 构图约定（12 套统一遵守）：
 *   · 场景画布按 1600×500（3.2:1）设计、铺满整卡；正圆主体（行星/太阳/月亮/
 *     奖杯/齿轮/能量核）单独一层按高度等比缩放，窄屏 20:9 也不会变成椭圆；
 *   · x < 40% 是姓名区、x > 75% 是成绩区 —— 这两个带里不放高对比主体，
 *     并统一盖一层左右压暗（V），实测叠白字可读；
 *   · 主体集中在 44%~74% 的中右带，靠大色块与轮廓，缩到 320×80 仍可辨；
 *   · 明度偏低到中，不出现大面积纯白/高亮；冷暖、几何与自然分开，避免 12 套同质。
 * ------------------------------------------------------------------
 */
(function () {
  'use strict';

  // 内联 SVG → 一个 background 层。
  // F：场景层，铺满整卡（山峦/楼群/树线这类拉伸 1.4 倍也看不出来）。
  // P：主体层，按「高度等比例」缩放并靠右定位 —— 行星、月亮、奖杯这些正圆
  //    在 20:9 窄屏里不会变成椭圆。透明底所以宽屏也不会露边。
  function enc(svg) { return 'url("data:image/svg+xml,' + encodeURIComponent(svg.replace(/\s+/g, ' ').trim()) + '")'; }
  function F(svg) { return enc(svg) + ' 0 0 / 100% 100% no-repeat'; }
  function P(svg, x) { return enc(svg) + ' ' + (x || 80) + '% 50% / auto 100% no-repeat'; }

  var HEAD = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 500" preserveAspectRatio="none">';
  // 主体层用各自的视窗（同一套 1600×500 坐标，只裁窗口，尺寸与铺满时一致）
  function V2(vb) { return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '">'; }
  // 统一 520×500 的主体窗口（以主体中心 cx 对齐），这样同一个定位百分数对各套都合适
  function PB(cx) { return V2((cx - 260) + ' -40 520 500'); }

  // 左右压暗：左 0~40%（姓名）+ 右 88~100%（成绩），中间留亮。
  // 全部 12 套共用，保证任何主题下文字都能读。
  var V = 'linear-gradient(90deg, rgba(3,6,16,.86) 0%, rgba(3,6,16,.56) 20%, rgba(3,6,16,.12) 38%, rgba(3,6,16,0) 52%, rgba(3,6,16,0) 73%, rgba(3,6,16,.52) 89%, rgba(3,6,16,.86) 100%)';

  // ---------------------------------------------------------------- 1 星河征途
  var GALAXY_S = HEAD
    + '<g fill="#fff" opacity=".6"><circle cx="620" cy="72" r="2.6"/><circle cx="712" cy="128" r="1.8"/><circle cx="800" cy="52" r="2.2"/><circle cx="892" cy="152" r="1.6"/><circle cx="962" cy="70" r="2.4"/><circle cx="1006" cy="330" r="1.8"/><circle cx="1186" cy="96" r="2"/><circle cx="700" cy="302" r="1.6"/><circle cx="862" cy="392" r="2.2"/><circle cx="1246" cy="300" r="1.6"/><circle cx="760" cy="200" r="1.4"/></g>'
    + '</svg>';
  var GALAXY_P = PB(1090)
    + '<defs><radialGradient id="g1" cx=".34" cy=".28" r=".86"><stop offset="0" stop-color="#d8cdff"/><stop offset=".48" stop-color="#7a5ff0"/><stop offset="1" stop-color="#231a52"/></radialGradient>'
    + '<linearGradient id="g2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8e7bff" stop-opacity="0"/><stop offset=".5" stop-color="#d9ceff" stop-opacity=".9"/><stop offset="1" stop-color="#8e7bff" stop-opacity="0"/></linearGradient></defs>'
    + '<g fill="none" stroke="#c3b2ff" transform="rotate(-16 1090 210)"><ellipse cx="1090" cy="210" rx="206" ry="52" stroke-width="13" opacity=".5"/><ellipse cx="1090" cy="210" rx="152" ry="35" stroke-width="4" opacity=".34"/></g>'
    + '<circle cx="1090" cy="210" r="104" fill="url(#g1)"/>'
    + '<ellipse cx="1090" cy="188" rx="74" ry="14" fill="url(#g2)" opacity=".35"/>'
    + '</svg>';

  // ---------------------------------------------------------------- 2 赛博都市
  // 楼体压暗、只让「楼顶轮廓 + 霓虹竖条 + 窗口」发亮，避免成为一坨黑块。
  var CYBER = HEAD
    + '<g fill="#05060f">'
    + '<rect x="600" y="306" width="88" height="194"/><rect x="696" y="238" width="74" height="262"/>'
    + '<rect x="778" y="286" width="96" height="214"/><rect x="882" y="196" width="80" height="304"/>'
    + '<rect x="970" y="256" width="92" height="244"/><rect x="1070" y="214" width="78" height="286"/>'
    + '<rect x="1156" y="300" width="88" height="200"/></g>'
    + '<g fill="#2ff0ff" opacity=".85"><rect x="600" y="306" width="88" height="4"/><rect x="778" y="286" width="96" height="3"/>'
    + '<rect x="882" y="196" width="80" height="5"/><rect x="1070" y="214" width="78" height="4"/>'
    + '<rect x="606" y="306" width="4" height="140"/><rect x="886" y="200" width="3" height="170"/><rect x="1074" y="218" width="3" height="140"/></g>'
    + '<g fill="#ff2d95" opacity=".85"><rect x="696" y="238" width="74" height="4"/><rect x="970" y="256" width="92" height="5"/>'
    + '<rect x="1156" y="300" width="88" height="3"/><rect x="700" y="242" width="3" height="150"/>'
    + '<rect x="1058" y="256" width="3" height="150"/><rect x="1160" y="304" width="3" height="110"/></g>'
    + '<g fill="#a8f8ff" opacity=".55"><rect x="626" y="348" width="26" height="7"/><rect x="626" y="370" width="26" height="7"/>'
    + '<rect x="626" y="392" width="26" height="7"/><rect x="902" y="232" width="22" height="7"/><rect x="902" y="254" width="22" height="7"/>'
    + '<rect x="902" y="276" width="22" height="7"/><rect x="1090" y="250" width="22" height="7"/><rect x="1090" y="272" width="22" height="7"/>'
    + '<rect x="990" y="292" width="24" height="7"/><rect x="990" y="314" width="24" height="7"/></g>'
    + '<g fill="#ffb3d6" opacity=".42"><rect x="722" y="282" width="20" height="7"/><rect x="722" y="304" width="20" height="7"/>'
    + '<rect x="1180" y="348" width="20" height="7"/><rect x="1180" y="370" width="20" height="7"/>'
    + '<rect x="1000" y="340" width="20" height="7"/></g>'
    + '<g stroke="#7ef7ff" stroke-width="2" opacity=".5"><path d="M924 196 V150 M1110 214 V166"/></g>'
    + '<g fill="#ff4fae" opacity=".8"><circle cx="924" cy="148" r="4"/><circle cx="1110" cy="164" r="3"/></g>'
    + '</svg>';

  // ---------------------------------------------------------------- 3 量子矩阵
  var QUANTUM = HEAD
    + '<g fill="none" stroke="#3fe6e0" stroke-width="3" opacity=".42">'
    + '<path d="M616 118 H772 V206 H902"/><path d="M636 336 H818 V268 H958 V184"/>'
    + '<path d="M690 76 H700 V196 H840 V262"/><path d="M1010 120 V232 H1120 V330"/>'
    + '<path d="M860 388 H960 V300"/><path d="M1150 96 V180 H1190"/></g>'
    + '<g fill="#7ff8f2" opacity=".62"><rect x="766" y="200" width="13" height="13"/><rect x="896" y="112" width="13" height="13"/><rect x="812" y="262" width="13" height="13"/><rect x="952" y="178" width="13" height="13"/><rect x="1114" y="324" width="13" height="13"/><rect x="954" y="294" width="13" height="13"/></g>'
    + '</svg>';
  var QUANTUM_P = PB(1096)
    + '<circle cx="1096" cy="216" r="60" fill="none" stroke="#69fff6" stroke-width="2" opacity=".3"/>'
    + '<circle cx="1096" cy="216" r="26" fill="none" stroke="#69fff6" stroke-width="2" opacity=".45"/>'
    + '<circle cx="1096" cy="216" r="6" fill="#9dfffa" opacity=".7"/>'
    + '</svg>';

  // ---------------------------------------------------------------- 4 日出云海
  var SUNRISE = HEAD
    + '<g fill="#ffe3ad" opacity=".18"><ellipse cx="720" cy="250" rx="200" ry="26"/><ellipse cx="1150" cy="290" rx="230" ry="30"/><ellipse cx="900" cy="300" rx="160" ry="20"/></g>'
    + '<path d="M0 500 V352 L250 322 L470 356 L700 300 L880 342 L1090 288 L1300 336 L1600 296 V500 Z" fill="#4a2b2c" opacity=".82"/>'
    + '<path d="M0 500 V404 L280 372 L520 404 L760 360 L980 396 L1200 356 L1600 392 V500 Z" fill="#251a20" opacity=".92"/>'
    + '</svg>';
  var SUNRISE_P = PB(1030)
    + '<defs><radialGradient id="s1" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff2c4"/><stop offset=".45" stop-color="#ffc86a"/><stop offset=".8" stop-color="#e88a3c"/><stop offset="1" stop-color="#e8843c" stop-opacity="0"/></radialGradient></defs>'
    + '<circle cx="1030" cy="210" r="150" fill="url(#s1)" opacity=".95"/>'
    + '</svg>';

  // ---------------------------------------------------------------- 5 极地之巅
  var ARCTIC = HEAD
    + '<defs><linearGradient id="a1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2fbff"/><stop offset="1" stop-color="#8fb6c9"/></linearGradient><linearGradient id="a2" x1="0" y1="0" x2=".4" y2="1"><stop offset="0" stop-color="#a8c9d8"/><stop offset="1" stop-color="#5c7f96"/></linearGradient></defs>'
    + '<path d="M600 500 L742 246 L838 372 L944 196 L1046 366 L1142 268 L1250 500 Z" fill="url(#a1)" opacity=".92"/>'
    + '<path d="M944 196 L1046 366 L992 366 L944 322 Z" fill="#547c96" opacity=".5"/>'
    + '<path d="M742 246 L838 372 L796 372 L742 326 Z" fill="#547c96" opacity=".42"/>'
    + '<path d="M1142 268 L1214 500 L1250 500 L1180 306 Z" fill="#547c96" opacity=".38"/>'
    + '<g fill="#ffffff" opacity=".55"><circle cx="912" cy="240" r="3"/><circle cx="726" cy="286" r="2.2"/><circle cx="1168" cy="316" r="2.4"/><circle cx="1006" cy="228" r="2"/></g>'
    + '<path d="M944 196 L1006 306 L944 288 L904 320 Z" fill="#ffffff" opacity=".55"/>'
    + '<path d="M742 246 L796 348 L742 332 L706 356 Z" fill="#ffffff" opacity=".4"/>'
    + '<path d="M600 500 L700 380 L780 420 L860 396 L960 440 L1040 410 L1250 500 Z" fill="url(#a2)" opacity=".7"/>'
    + '<path d="M0 500 V430 L220 400 L420 428 L600 396 V500 Z" fill="#25415a" opacity=".55"/>'
    + '<path d="M1120 500 V424 L1320 396 L1600 430 V500 Z" fill="#25415a" opacity=".55"/>'
    + '</svg>';

  // ---------------------------------------------------------------- 6 樱花物语
  // 五瓣花用 <use> 复用同一个花瓣组，避免重复圆点把体积撑大。
  var SAKURA = HEAD
    + '<defs><g id="fl"><circle cx="11" cy="0" r="10"/><circle cx="3.4" cy="10.5" r="10"/><circle cx="-8.9" cy="6.5" r="10"/><circle cx="-8.9" cy="-6.5" r="10"/><circle cx="3.4" cy="-10.5" r="10"/><circle cx="0" cy="0" r="4.6" fill="#ff8db4"/></g></defs>'
    + '<g fill="#ffe8f1" opacity=".06"><circle cx="884" cy="176" r="126"/><circle cx="1146" cy="336" r="92"/><circle cx="770" cy="386" r="74"/></g>'
    + '<g fill="none" stroke="#2b1822" stroke-linecap="round" opacity=".85">'
    + '<path d="M1256 24 C1160 108 1078 132 998 126 C926 120 872 92 818 52" stroke-width="12"/>'
    + '<path d="M1090 130 C1062 196 1018 238 962 264" stroke-width="7"/>'
    + '<path d="M1148 104 C1126 166 1098 196 1058 214" stroke-width="6"/>'
    + '<path d="M950 118 C930 168 900 196 866 210" stroke-width="5"/></g>'
    + '<g fill="#ffe1ec">'
    + '<use href="#fl" transform="translate(1000 124) scale(1.32) rotate(8)"/>'
    + '<use href="#fl" transform="translate(958 264) scale(1.14) rotate(-16)"/>'
    + '<use href="#fl" transform="translate(1058 214) scale(.98) rotate(22)"/>'
    + '<use href="#fl" transform="translate(866 210) scale(1.02) rotate(-8)"/>'
    + '<use href="#fl" transform="translate(1148 100) scale(.94) rotate(30)"/>'
    + '<use href="#fl" transform="translate(1090 130) scale(.9) rotate(-24)"/>'
    + '<use href="#fl" transform="translate(926 150) scale(.84) rotate(14)"/>'
    + '<use href="#fl" transform="translate(1150 178) scale(.78) rotate(-4)"/>'
    + '<use href="#fl" transform="translate(1014 188) scale(.72) rotate(18)"/>'
    + '</g>'
    + '<g fill="#ffc9db"><use href="#fl" transform="translate(902 254) scale(.66) rotate(-30)"/><use href="#fl" transform="translate(1186 226) scale(.6) rotate(10)"/></g>'
    + '<g fill="#ffd3e2" opacity=".55"><ellipse cx="760" cy="316" rx="7" ry="4" transform="rotate(-24 760 316)"/><ellipse cx="812" cy="356" rx="6" ry="3.5" transform="rotate(16 812 356)"/><ellipse cx="700" cy="252" rx="5" ry="3" transform="rotate(-10 700 252)"/><ellipse cx="684" cy="392" rx="6" ry="3.5" transform="rotate(28 684 392)"/><ellipse cx="880" cy="300" rx="5" ry="3" transform="rotate(-40 880 300)"/></g>'
    + '</svg>';

  // ---------------------------------------------------------------- 7 深海鲸歌
  var WHALE = HEAD
    + '<defs><linearGradient id="w1" x1="0" y1="0" x2=".2" y2="1"><stop offset="0" stop-color="#63bad3"/><stop offset=".5" stop-color="#2b7691"/><stop offset="1" stop-color="#123a4b"/></linearGradient></defs>'
    + '<g fill="#cdf6ff" opacity=".07"><polygon points="700,0 780,0 940,500 800,500"/><polygon points="860,0 912,0 1080,500 970,500"/><polygon points="1030,0 1070,0 1220,500 1150,500"/></g>'
    + '<path d="M800 332 C858 250 992 232 1082 282 C1122 304 1166 312 1198 294 L1226 262 L1214 312 L1244 352 L1200 340 C1156 370 1076 380 992 364 C896 346 816 368 800 332 Z" fill="url(#w1)"/>'
    + '<path d="M800 332 C858 250 992 232 1082 282" fill="none" stroke="#a7e6f7" stroke-width="4" opacity=".6"/>'
    + '<path d="M980 338 C1002 384 1042 402 1082 398 C1046 380 1016 358 1002 334 Z" fill="#1a5670" opacity=".95"/>'
    + '<path d="M852 352 C930 372 1030 376 1110 358 C1040 380 930 384 852 352 Z" fill="#8dd4e6" opacity=".35"/>'
    + '<circle cx="848" cy="308" r="4.5" fill="#d9fbff"/>'
    + '<g fill="none" stroke="#9ee4f6" opacity=".38"><circle cx="1150" cy="196" r="10"/><circle cx="1186" cy="158" r="6"/><circle cx="1216" cy="122" r="4"/><circle cx="890" cy="196" r="7"/><circle cx="846" cy="156" r="4"/></g>'
    + '</svg>';

  // ---------------------------------------------------------------- 8 像素冒险
  // 阶梯状方块山丘（每一层都是 32px 网格的整数倍），缩到 320 宽仍是清楚的色阶。
  var PIXEL = HEAD
    + '<g fill="#ffffff" opacity=".24"><rect x="660" y="86" width="96" height="24"/><rect x="700" y="62" width="56" height="24"/>'
    + '<rect x="1060" y="118" width="80" height="24"/><rect x="1100" y="94" width="40" height="24"/></g>'
    + '<g fill="#ffe9a3" opacity=".8"><rect x="1156" y="52" width="56" height="56"/></g>'
    + '<g fill="#1f5330"><rect x="600" y="436" width="700" height="64"/><rect x="660" y="404" width="580" height="32"/>'
    + '<rect x="720" y="372" width="460" height="32"/><rect x="800" y="340" width="300" height="32"/><rect x="880" y="308" width="160" height="32"/></g>'
    + '<g fill="#3f9a52"><rect x="600" y="436" width="700" height="10"/><rect x="660" y="404" width="580" height="10"/>'
    + '<rect x="720" y="372" width="460" height="10"/><rect x="800" y="340" width="300" height="10"/><rect x="880" y="308" width="160" height="10"/></g>'
    + '<g fill="#163b22"><rect x="720" y="472" width="32" height="28"/><rect x="800" y="472" width="32" height="28"/>'
    + '<rect x="960" y="472" width="32" height="28"/><rect x="1080" y="472" width="32" height="28"/>'
    + '<rect x="1180" y="440" width="32" height="28"/><rect x="680" y="440" width="32" height="28"/>'
    + '<rect x="880" y="372" width="32" height="32"/></g>'
    + '<g fill="#6b4a2a"><rect x="772" y="404" width="14" height="32"/><rect x="1032" y="436" width="14" height="32"/></g>'
    + '<g fill="#2b6b3a"><rect x="748" y="372" width="62" height="32"/><rect x="760" y="340" width="38" height="32"/>'
    + '<rect x="1008" y="404" width="62" height="32"/><rect x="1020" y="372" width="38" height="32"/></g>'
    + '</svg>';

  // ---------------------------------------------------------------- 9 月夜旅人
  // 月牙用 mask(白圆 - 偏移黑圆) 扣出来，比双弧 path 稳。
  var MOONNIGHT = HEAD
    + '<g fill="#fff" opacity=".55"><circle cx="700" cy="110" r="2.2"/><circle cx="790" cy="70" r="1.6"/><circle cx="880" cy="150" r="2"/><circle cx="960" cy="86" r="1.6"/><circle cx="1210" cy="120" r="2"/><circle cx="1250" cy="70" r="1.4"/><circle cx="660" cy="230" r="1.6"/><circle cx="1220" cy="250" r="1.6"/></g>'
    + '<path d="M1150 52 L1224 116" stroke="#fff8e0" stroke-width="3" opacity=".65" stroke-linecap="round"/>'
    + '<path d="M1140 40 L1158 58" stroke="#fff8e0" stroke-width="2" opacity=".3" stroke-linecap="round"/>'
    + '<g fill="#ffffff" opacity=".05"><ellipse cx="960" cy="236" rx="150" ry="16"/><ellipse cx="1160" cy="290" rx="120" ry="12"/></g>'
    + '<path d="M0 500 V402 L240 356 L470 396 L700 352 L910 390 L1130 344 L1360 388 L1600 350 V500 Z" fill="#0d1430" opacity=".92"/>'
    + '<path d="M0 500 V444 L300 414 L560 446 L820 410 L1080 444 L1360 412 L1600 440 V500 Z" fill="#070b1c" opacity=".95"/>'
    + '</svg>';
  // 月牙用 mask(白圆 - 偏移黑圆) 扣出来，比双弧 path 稳。
  var MOONNIGHT_P = PB(1074)
    + '<defs><linearGradient id="m1" x1="0" y1="0" x2=".7" y2="1"><stop offset="0" stop-color="#fffdf0"/><stop offset="1" stop-color="#ffe6a0"/></linearGradient>'
    + '<mask id="mk"><rect x="800" y="-60" width="560" height="620" fill="#000"/><circle cx="1074" cy="178" r="86" fill="#fff"/><circle cx="1112" cy="160" r="76" fill="#000"/></mask></defs>'
    + '<circle cx="1066" cy="186" r="132" fill="#ffeeb8" opacity=".07"/>'
    + '<circle cx="1074" cy="178" r="86" fill="url(#m1)" mask="url(#mk)"/>'
    + '</svg>';

  // ---------------------------------------------------------------- 10 极光秘境
  var AURORA = HEAD
    + '<defs><linearGradient id="u1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6bffc8" stop-opacity=".0"/><stop offset=".35" stop-color="#6bffc8" stop-opacity=".55"/><stop offset="1" stop-color="#2bb6ff" stop-opacity="0"/></linearGradient><linearGradient id="u2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9d7bff" stop-opacity="0"/><stop offset=".4" stop-color="#7b6bff" stop-opacity=".45"/><stop offset="1" stop-color="#2bb6ff" stop-opacity="0"/></linearGradient></defs>'
    + '<g fill="#fff" opacity=".4"><circle cx="720" cy="70" r="2"/><circle cx="860" cy="110" r="1.6"/><circle cx="1000" cy="56" r="2"/><circle cx="1160" cy="96" r="1.6"/><circle cx="1240" cy="40" r="1.4"/></g>'
    + '<path d="M628 6 C702 96 700 218 646 342 L704 342 C758 214 754 96 688 6 Z" fill="url(#u1)"/>'
    + '<path d="M764 0 C842 106 826 238 772 358 L836 358 C892 234 900 102 822 0 Z" fill="url(#u1)" opacity=".7"/>'
    + '<path d="M900 28 C978 132 960 246 910 354 L970 354 C1022 246 1026 130 956 28 Z" fill="url(#u2)" opacity=".85"/>'
    + '<path d="M1014 14 C1066 122 1058 242 1026 332 L1058 332 C1094 238 1096 118 1046 14 Z" fill="url(#u2)" opacity=".45"/>'
    + '<g fill="#04140f"><path d="M600 500 L620 356 L640 500 Z"/><path d="M660 500 L690 320 L720 500 Z"/><path d="M740 500 L770 372 L800 500 Z"/><path d="M830 500 L868 300 L906 500 Z"/><path d="M940 500 L970 348 L1000 500 Z"/><path d="M1030 500 L1062 322 L1094 500 Z"/><path d="M1120 500 L1150 366 L1180 500 Z"/><path d="M1200 500 L1236 336 L1272 500 Z"/></g>'
    + '<rect x="0" y="474" width="1600" height="26" fill="#03100c" opacity=".9"/>'
    + '</svg>';

  // ---------------------------------------------------------------- 11 熔金荣耀
  var GOLD = HEAD
    + '<g fill="#ffce6b" opacity=".16"><polygon points="1064,26 1040,240 1090,240"/><polygon points="934,54 1000,238 1030,222"/><polygon points="1194,54 1128,238 1098,222"/></g>'
    + '<g fill="none" stroke="#ffd98a" stroke-width="5" opacity=".38" stroke-linecap="round">'
    + '<path d="M960 300 C988 356 1032 384 1090 388"/><path d="M1220 300 C1192 356 1148 384 1090 388"/></g>'
    + '<g fill="#ffdf9a" opacity=".5"><circle cx="972" cy="330" r="7"/><circle cx="1180" cy="330" r="7"/><circle cx="1006" cy="368" r="6"/><circle cx="1148" cy="368" r="6"/><circle cx="1048" cy="386" r="5"/><circle cx="1112" cy="386" r="5"/></g>'
    + '<g fill="#ffeab4" opacity=".45"><circle cx="900" cy="150" r="3"/><circle cx="1250" cy="150" r="2.6"/><circle cx="820" cy="260" r="2.2"/><circle cx="1300" cy="250" r="2.6"/><circle cx="960" cy="90" r="2"/></g>'
    + '</svg>';
  // 奖杯单独一层，避免窄屏把杯身拉长
  var GOLD_P = PB(1090)
    + '<defs><linearGradient id="gld" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe7a8"/><stop offset=".5" stop-color="#e0a53c"/><stop offset="1" stop-color="#9a6a1d"/></linearGradient></defs>'
    + '<path d="M1024 176 H1156 V220 C1156 268 1124 296 1090 296 C1056 296 1024 268 1024 220 Z" fill="url(#gld)" opacity=".92"/>'
    + '<g fill="none" stroke="#e8b45c" stroke-width="7" opacity=".7"><path d="M1024 192 C994 192 988 236 1024 244"/><path d="M1156 192 C1186 192 1192 236 1156 244"/></g>'
    + '<rect x="1080" y="296" width="20" height="42" fill="#c8952f" opacity=".9"/>'
    + '<rect x="1046" y="338" width="88" height="18" rx="6" fill="#d9a441" opacity=".9"/>'
    + '</svg>';

  // ---------------------------------------------------------------- 12 机械核心
  var MECH = HEAD
    + '<g fill="#233238" opacity=".8"><rect x="700" y="392" width="120" height="18"/><rect x="700" y="418" width="80" height="12"/>'
    + '<rect x="1240" y="392" width="120" height="18"/><rect x="1280" y="418" width="80" height="12"/></g>'
    + '</svg>';
  var MECH_P = PB(1080)
    + '<defs><radialGradient id="mc" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#b9fff6"/><stop offset=".55" stop-color="#38b4c9"/><stop offset="1" stop-color="#123c4a"/></radialGradient></defs>'
    + '<g transform="rotate(14 1080 240)" fill="none" stroke="#5f7d88" stroke-linecap="butt">'
    + '<circle cx="1080" cy="240" r="118" stroke-width="26" stroke-dasharray="20 15" opacity=".55"/>'
    + '<circle cx="1080" cy="240" r="86" stroke-width="4" opacity=".5"/></g>'
    + '<g transform="rotate(-22 1080 240)" fill="none" stroke="#41616d"><circle cx="1080" cy="240" r="150" stroke-width="14" stroke-dasharray="26 22" opacity=".35"/></g>'
    + '<circle cx="1080" cy="240" r="62" fill="#0a1a20" stroke="#7fd6e2" stroke-width="3" opacity=".9"/>'
    + '<circle cx="1080" cy="240" r="34" fill="url(#mc)" opacity=".95"/>'
    + '<g stroke="#6fe0ef" stroke-width="2" opacity=".45" fill="none"><path d="M880 240 H940"/><path d="M1220 240 H1280"/><path d="M1080 100 V150"/><path d="M1080 330 V382"/></g>'
    + '<g fill="#8ff2ff" opacity=".55"><rect x="936" y="234" width="12" height="12"/><rect x="1212" y="234" width="12" height="12"/><rect x="1074" y="146" width="12" height="12"/><rect x="1074" y="326" width="12" height="12"/></g>'
    + '</svg>';

  // ---------------------------------------------------------------- 12 套清单
  // 顺序即主程序选择面板里的顺序，k 只用英文小写。
  window.RANK_BG_PRESETS = [
    {
      k: 'galaxy', name: '星河征途',
      css: V + ', ' + P(GALAXY_P) + ', ' + F(GALAXY_S) + ', '
        + 'radial-gradient(70% 96% at 66% 42%, rgba(118,86,255,.44) 0%, rgba(118,86,255,0) 62%), '
        + 'radial-gradient(42% 62% at 50% 84%, rgba(255,116,214,.16) 0%, rgba(255,116,214,0) 70%), '
        + 'linear-gradient(158deg, #0a0d2c 0%, #141c4e 44%, #06091d 100%)'
    },
    {
      k: 'cyber', name: '赛博都市',
      css: V + ', ' + F(CYBER) + ', '
        + 'radial-gradient(34% 60% at 56% 88%, rgba(255,45,149,.34) 0%, rgba(255,45,149,0) 68%), '
        + 'radial-gradient(34% 62% at 66% 84%, rgba(38,224,255,.30) 0%, rgba(38,224,255,0) 66%), '
        + 'linear-gradient(178deg, #0a0b1c 0%, #141232 46%, #04050d 100%)'
    },
    {
      k: 'quantum', name: '量子矩阵',
      css: V + ', ' + P(QUANTUM_P) + ', ' + F(QUANTUM) + ', '
        + 'repeating-linear-gradient(90deg, rgba(53,227,224,.10) 0 1px, rgba(53,227,224,0) 1px 48px), '
        + 'repeating-linear-gradient(0deg, rgba(53,227,224,.09) 0 1px, rgba(53,227,224,0) 1px 48px), '
        + 'radial-gradient(48% 80% at 66% 46%, rgba(40,214,206,.28) 0%, rgba(40,214,206,0) 70%), '
        + 'linear-gradient(150deg, #04181d 0%, #073039 52%, #031117 100%)'
    },
    {
      k: 'sunrise', name: '日出云海',
      // 太阳压在远山之后（先画太阳再画山），才是「日出」
      css: V + ', ' + F(SUNRISE) + ', ' + P(SUNRISE_P) + ', '
        + 'radial-gradient(36% 68% at 64% 40%, rgba(255,206,124,.55) 0%, rgba(255,206,124,0) 72%), '
        + 'linear-gradient(178deg, #2b1732 0%, #6d3145 24%, #c2683f 46%, #eda94f 68%, #f6d08d 88%, #f3c684 100%)'
    },
    {
      k: 'arctic', name: '极地之巅',
      css: V + ', ' + F(ARCTIC) + ', '
        + 'radial-gradient(40% 70% at 64% 44%, rgba(216,244,255,.42) 0%, rgba(216,244,255,0) 70%), '
        + 'linear-gradient(172deg, #0d2133 0%, #1b3f56 36%, #4e7891 66%, #93b3c3 100%)'
    },
    {
      k: 'sakura', name: '樱花物语',
      css: V + ', ' + F(SAKURA) + ', '
        + 'radial-gradient(40% 68% at 66% 26%, rgba(255,220,234,.40) 0%, rgba(255,220,234,0) 72%), '
        + 'radial-gradient(46% 60% at 62% 100%, rgba(58,26,40,.42) 0%, rgba(58,26,40,0) 72%), '
        + 'linear-gradient(196deg, #3a1f2e 0%, #6b384d 26%, #95546b 52%, #b9768b 76%, #8c4d62 100%)'
    },
    {
      k: 'whale', name: '深海鲸歌',
      css: V + ', ' + F(WHALE) + ', '
        + 'radial-gradient(46% 80% at 64% 34%, rgba(120,220,255,.26) 0%, rgba(120,220,255,0) 70%), '
        + 'radial-gradient(50% 60% at 40% 100%, rgba(10,80,110,.55) 0%, rgba(10,80,110,0) 72%), '
        + 'linear-gradient(180deg, #052331 0%, #0a3746 48%, #03141d 100%)'
    },
    {
      k: 'pixel', name: '像素冒险',
      css: V + ', ' + F(PIXEL) + ', '
        + 'linear-gradient(180deg, #2c5cb8 0%, #4d80d2 34%, #7fb2e6 56%, #9cc4ea 74%, #4f7f45 88%, #2c5b34 100%)'
    },
    {
      k: 'moon', name: '月夜旅人',
      css: V + ', ' + P(MOONNIGHT_P) + ', ' + F(MOONNIGHT) + ', '
        + 'radial-gradient(30% 56% at 66% 38%, rgba(255,236,168,.30) 0%, rgba(255,236,168,0) 72%), '
        + 'linear-gradient(172deg, #070c24 0%, #111a42 40%, #1a2450 68%, #0a1028 100%)'
    },
    {
      k: 'aurora', name: '极光秘境',
      css: V + ', ' + F(AURORA) + ', '
        + 'linear-gradient(104deg, rgba(80,255,196,0) 30%, rgba(80,255,196,.22) 40%, rgba(80,255,196,0) 50%), '
        + 'linear-gradient(96deg, rgba(120,120,255,0) 46%, rgba(130,110,255,.20) 56%, rgba(120,120,255,0) 66%), '
        + 'radial-gradient(44% 70% at 62% 30%, rgba(52,206,190,.22) 0%, rgba(52,206,190,0) 70%), '
        + 'linear-gradient(178deg, #04121c 0%, #072430 46%, #051a18 76%, #020c09 100%)'
    },
    {
      k: 'gold', name: '熔金荣耀',
      css: V + ', ' + P(GOLD_P) + ', ' + F(GOLD) + ', '
        + 'radial-gradient(38% 70% at 66% 42%, rgba(255,196,88,.40) 0%, rgba(255,196,88,0) 72%), '
        + 'linear-gradient(118deg, rgba(255,214,140,.10) 0 14%, rgba(255,214,140,0) 14% 100%), '
        + 'linear-gradient(160deg, #150d05 0%, #2a1b0b 46%, #120a04 100%)'
    },
    {
      k: 'mech', name: '机械核心',
      css: V + ', ' + P(MECH_P) + ', ' + F(MECH) + ', '
        + 'repeating-linear-gradient(60deg, rgba(120,190,205,.07) 0 1px, rgba(120,190,205,0) 1px 38px), '
        + 'repeating-linear-gradient(-60deg, rgba(120,190,205,.06) 0 1px, rgba(120,190,205,0) 1px 38px), '
        + 'radial-gradient(34% 62% at 66% 48%, rgba(96,226,240,.30) 0%, rgba(96,226,240,0) 68%), '
        + 'linear-gradient(150deg, #11151a 0%, #1d262c 48%, #0b0e12 100%)'
    }
  ];

  // ---------------------------------------------------------------- 取样式
  var MAP = {};
  for (var i = 0; i < window.RANK_BG_PRESETS.length; i++) {
    MAP[window.RANK_BG_PRESETS[i].k] = window.RANK_BG_PRESETS[i].css;
  }

  /**
   * 预设键 → 可直接赋给 background 的样式串。
   * 'none' / '' / 未知键 → ''（调用方走默认底）。
   * 顺手容忍调用方误传的 'p:<k>'（后端存的是带前缀的键）。
   */
  window.rankBgCss = function (k) {
    if (!k || typeof k !== 'string') return '';
    var key = k.indexOf('p:') === 0 ? k.slice(2) : k;
    if (key === 'none') return '';
    return MAP[key] || '';
  };
})();
