import type { CSSProperties } from "react";

type Phase = {
  id: string;
  sky: string;
  haze: string;
  backHill: string;
  midHill: string;
  frontHill: string;
  farHill: string;
  water: string;
  waterDark: string;
  path: string;
  tree: string;
  treeDark: string;
  bush: string;
  flowerA: string;
  flowerB: string;
  cloud: string;
};

const phases: Phase[] = [
  {
    id: "morning",
    sky: "#35b8ff",
    haze: "#dff6ff",
    backHill: "#88d941",
    midHill: "#53c83f",
    frontHill: "#28a84f",
    farHill: "#b9ec69",
    water: "#26b8f2",
    waterDark: "#148fd6",
    path: "#e4d18b",
    tree: "#18a957",
    treeDark: "#0b7f47",
    bush: "#58c53e",
    flowerA: "#ea4335",
    flowerB: "#fbbc04",
    cloud: "#fff6e8",
  },
  {
    id: "rain",
    sky: "#3d8fc6",
    haze: "#a9dcf3",
    backHill: "#62c35c",
    midHill: "#31ad56",
    frontHill: "#168954",
    farHill: "#91d76e",
    water: "#3bb7dd",
    waterDark: "#1d82b5",
    path: "#8fb5b7",
    tree: "#129b54",
    treeDark: "#087247",
    bush: "#3fb653",
    flowerA: "#ea4335",
    flowerB: "#fbbc04",
    cloud: "#c7deec",
  },
  {
    id: "sunset",
    sky: "#ff9d57",
    haze: "#ffd56f",
    backHill: "#7fc85b",
    midHill: "#52b955",
    frontHill: "#2e9f4f",
    farHill: "#a9dc6a",
    water: "#2caee8",
    waterDark: "#197fc8",
    path: "#dfb76f",
    tree: "#238d42",
    treeDark: "#176436",
    bush: "#65a942",
    flowerA: "#ea4335",
    flowerB: "#fbbc04",
    cloud: "#ffbd65",
  },
  {
    id: "night",
    sky: "#0d47a1",
    haze: "#1f6fc5",
    backHill: "#2f8b63",
    midHill: "#1f7958",
    frontHill: "#12674d",
    farHill: "#54a36f",
    water: "#1478d4",
    waterDark: "#0b4f9f",
    path: "#5d7b91",
    tree: "#0b6d54",
    treeDark: "#06433d",
    bush: "#0b7555",
    flowerA: "#7aa7ff",
    flowerB: "#ffd966",
    cloud: "#2b73d2",
  },
];

export function HomeAnimatedScene() {
  return (
    <div className="home-scene" aria-hidden="true">
      {phases.map((phase, index) => (
        <svg
          key={phase.id}
          className={`home-vector-layer home-vector-${phase.id}`}
          viewBox="0 0 1600 900"
          preserveAspectRatio="xMidYMid slice"
          style={{
            "--phase-delay": `${index * 14}s`,
            "--drift-delay": `${index * -1.5}s`,
          } as CSSProperties}
        >
          <CartoonPhase phase={phase} />
        </svg>
      ))}
      <div className="home-cartoon-sky-actors">
        <span className="home-cartoon-sun" />
        <span className="home-cartoon-moon" />
      </div>
      <div className="home-cartoon-clouds">
        <span />
        <span />
        <span />
      </div>
      <div className="home-cartoon-wind">
        <span />
        <span />
        <span />
      </div>
      <div className="home-cartoon-water">
        <span />
        <span />
        <span />
      </div>
      <div className="home-cartoon-leaves">
        {Array.from({ length: 12 }, (_, index) => (
          <span
            key={index}
            style={{
              "--leaf-x": `${4 + ((index * 13) % 92)}%`,
              "--leaf-delay": `${index * -0.72}s`,
              "--leaf-speed": `${7.5 + (index % 4) * 0.6}s`,
            } as CSSProperties}
          />
        ))}
      </div>
      <div className="home-cartoon-rain">
        {Array.from({ length: 18 }, (_, index) => (
          <span
            key={index}
            style={{
              "--drop-x": `${6 + ((index * 17) % 88)}%`,
              "--drop-delay": `${index * -0.18}s`,
              "--drop-speed": `${1.45 + (index % 5) * 0.08}s`,
            } as CSSProperties}
          />
        ))}
      </div>
      <div className="home-cartoon-stars">
        {Array.from({ length: 14 }, (_, index) => (
          <span
            key={index}
            style={{
              "--star-x": `${5 + ((index * 23) % 90)}%`,
              "--star-y": `${8 + ((index * 19) % 42)}%`,
              "--star-delay": `${index * -0.33}s`,
            } as CSSProperties}
          />
        ))}
      </div>
      <div className="home-cartoon-sparkles">
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="home-scene-scrim" />
      <div className="home-scene-glow" />
    </div>
  );
}

function CartoonPhase({ phase }: { phase: Phase }) {
  const isRain = phase.id === "rain";
  const isSunset = phase.id === "sunset";
  const isNight = phase.id === "night";

  return (
    <>
      <rect width="1600" height="900" fill={phase.sky} />
      <rect y="250" width="1600" height="650" fill={phase.haze} opacity={isNight ? 0.18 : 0.42} />

      {isSunset && <Sun x={1004} y={404} size={82} warm />}
      {isNight && <Moon />}

      <Cloud x={96} y={126} scale={0.74} color={phase.cloud} opacity={isNight ? 0.76 : 0.88} />
      <Cloud x={612} y={82} scale={0.46} color={phase.cloud} opacity={isSunset ? 0.54 : 0.72} />
      <Cloud x={1032} y={78} scale={1.18} color={phase.cloud} opacity={isNight ? 0.58 : 0.9} />
      {isRain && (
        <>
          <Cloud x={420} y={60} scale={1.25} color="#b9d3e5" opacity={0.82} />
          <Cloud x={930} y={68} scale={0.96} color="#bdd7e7" opacity={0.76} />
        </>
      )}

      {isNight && <Stars />}
      {isRain && <StaticRain />}

      <path d="M0 450 C160 330 290 420 430 310 C600 175 760 360 910 284 C1130 168 1335 306 1600 205 L1600 900 L0 900 Z" fill={phase.farHill} opacity={isNight ? 0.7 : 1} />
      <path d="M0 536 C158 438 312 512 474 394 C640 273 806 430 985 328 C1190 212 1378 376 1600 310 L1600 900 L0 900 Z" fill={phase.backHill} />
      <path d="M0 640 C190 500 366 605 552 475 C728 352 958 555 1120 438 C1314 300 1440 472 1600 414 L1600 900 L0 900 Z" fill={phase.midHill} />

      <Lake phase={phase} />

      <path d="M0 720 C166 610 382 715 560 620 C742 525 958 690 1136 585 C1306 485 1470 600 1600 548 L1600 900 L0 900 Z" fill={phase.frontHill} />
      <Path phase={phase} />

      <Tree x={132} y={632} scale={1.24} phase={phase} />
      <Tree x={244} y={542} scale={0.52} phase={phase} />
      <Tree x={306} y={500} scale={0.42} phase={phase} />
      <Tree x={1134} y={582} scale={0.76} phase={phase} pine />
      <Tree x={1320} y={498} scale={0.52} phase={phase} pine />
      <Tree x={1460} y={594} scale={1.34} phase={phase} />

      <Bushes phase={phase} />
      <Flowers phase={phase} />
      <Rocks isNight={isNight} />
    </>
  );
}

function Sun({ x, y, size, warm = false }: { x: number; y: number; size: number; warm?: boolean }) {
  const color = warm ? "#ffe070" : "#fbbc04";
  return (
    <g>
      <circle cx={x} cy={y} r={size} fill={color} opacity={0.98} />
      <circle cx={x} cy={y} r={size + 44} fill={color} opacity={0.16} />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
        const rad = (angle * Math.PI) / 180;
        const x1 = x + Math.cos(rad) * (size + 24);
        const y1 = y + Math.sin(rad) * (size + 24);
        const x2 = x + Math.cos(rad) * (size + 58);
        const y2 = y + Math.sin(rad) * (size + 58);
        return <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth="12" strokeLinecap="round" opacity={warm ? 0.38 : 0.8} />;
      })}
    </g>
  );
}

function Moon() {
  return (
    <g>
      <circle cx="1305" cy="126" r="64" fill="#ffe082" />
      <circle cx="1330" cy="106" r="66" fill="#0d47a1" />
      <circle cx="1305" cy="126" r="92" fill="#ffe082" opacity="0.12" />
    </g>
  );
}

function Cloud({ x, y, scale, color, opacity = 1 }: { x: number; y: number; scale: number; color: string; opacity?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity}>
      <ellipse cx="94" cy="68" rx="88" ry="42" fill={color} />
      <circle cx="44" cy="58" r="38" fill={color} />
      <circle cx="104" cy="34" r="58" fill={color} />
      <circle cx="170" cy="58" r="46" fill={color} />
      <rect x="38" y="60" width="168" height="50" rx="25" fill={color} />
    </g>
  );
}

function Stars() {
  const stars = [
    [162, 94], [270, 126], [390, 84], [552, 140], [710, 96], [846, 150], [1000, 86],
    [1134, 176], [1242, 98], [1424, 152], [1502, 80], [646, 220], [332, 230],
  ];
  return (
    <g fill="#ffe082" opacity="0.92">
      {stars.map(([x, y], index) => (
        <rect key={index} x={x} y={y} width="8" height="8" rx="2" transform={`rotate(45 ${x + 4} ${y + 4})`} />
      ))}
    </g>
  );
}

function StaticRain() {
  return (
    <g stroke="#8bd7ff" strokeWidth="3" strokeLinecap="round" opacity="0.18">
      {Array.from({ length: 26 }, (_, index) => {
        const x = 42 + ((index * 67) % 1500);
        const y = 38 + ((index * 91) % 410);
        return <line key={index} x1={x} y1={y} x2={x - 10} y2={y + 28} />;
      })}
    </g>
  );
}

function Lake({ phase }: { phase: Phase }) {
  return (
    <g>
      <path d="M462 493 C620 418 824 420 1018 486 C1110 518 1174 582 1112 632 C1015 710 742 704 572 656 C436 616 342 550 462 493 Z" fill={phase.water} />
      <path d="M552 545 C680 505 842 506 1014 552 C900 590 706 596 552 545 Z" fill={phase.waterDark} opacity="0.35" />
      <path d="M610 525 C720 500 840 502 960 528" stroke="#ffffff" strokeWidth="8" strokeLinecap="round" opacity="0.28" />
    </g>
  );
}

function Path({ phase }: { phase: Phase }) {
  return (
    <path
      d="M300 900 C382 826 492 790 584 742 C658 704 736 666 820 624 C812 682 842 752 906 836 C962 866 1000 888 1024 900 Z"
      fill={phase.path}
      opacity={phase.id === "rain" ? 0.66 : phase.id === "night" ? 0.78 : 0.84}
    />
  );
}

function Tree({ x, y, scale, phase, pine = false }: { x: number; y: number; scale: number; phase: Phase; pine?: boolean }) {
  if (pine) {
    return (
      <g transform={`translate(${x} ${y}) scale(${scale})`}>
        <rect x="-12" y="70" width="24" height="78" rx="8" fill="#8a5a2b" />
        <path d="M0 0 L-68 96 H68 Z" fill={phase.treeDark} />
        <path d="M0 -48 L-56 48 H56 Z" fill={phase.tree} />
        <path d="M0 -92 L-42 -14 H42 Z" fill={phase.tree} opacity="0.9" />
      </g>
    );
  }
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <rect x="-16" y="54" width="32" height="112" rx="10" fill="#8a5a2b" />
      <circle cx="-42" cy="46" r="48" fill={phase.treeDark} />
      <circle cx="0" cy="15" r="64" fill={phase.tree} />
      <circle cx="54" cy="54" r="50" fill={phase.treeDark} />
      <circle cx="-6" cy="76" r="62" fill={phase.tree} />
    </g>
  );
}

function Bushes({ phase }: { phase: Phase }) {
  const bushes = [
    [30, 740, 1.5], [210, 784, 1.1], [398, 704, 0.8], [1220, 710, 1.1], [1390, 760, 1.4], [1510, 714, 0.9],
  ];
  return (
    <g>
      {bushes.map(([x, y, scale], index) => (
        <g key={index} transform={`translate(${x} ${y}) scale(${scale})`}>
          <rect x="34" y="30" width="20" height="72" rx="8" fill={phase.id === "night" ? "#7b5639" : "#9b6a38"} opacity="0.92" />
          <circle cx="0" cy="20" r="38" fill={phase.bush} />
          <circle cx="44" cy="4" r="44" fill={phase.bush} />
          <circle cx="92" cy="22" r="34" fill={phase.id === "night" ? phase.treeDark : phase.bush} opacity={phase.id === "night" ? 0.82 : 1} />
          <rect x="-6" y="24" width="128" height="42" rx="22" fill={phase.bush} />
        </g>
      ))}
    </g>
  );
}

function Flowers({ phase }: { phase: Phase }) {
  const daytimeFlowers = [
    [70, 828], [122, 808], [178, 788], [238, 824], [1118, 818], [1180, 788], [1236, 838],
    [1290, 812], [1360, 842], [1408, 798], [1464, 842], [1528, 812],
  ];
  const nightFlowers = [
    [122, 808], [238, 824], [1180, 788], [1290, 812], [1408, 798], [1464, 842],
  ];
  const flowers = phase.id === "night" || phase.id === "rain" ? nightFlowers : daytimeFlowers;
  return (
    <g>
      {flowers.map(([x, y], index) => (
        <g key={index} transform={`translate(${x} ${y})`}>
          <line x1="0" y1="10" x2="0" y2="30" stroke="#188038" strokeWidth="3" strokeLinecap="round" />
          <circle cx="-7" cy="5" r="7" fill={index % 2 ? phase.flowerA : phase.flowerB} />
          <circle cx="7" cy="5" r="7" fill={index % 2 ? phase.flowerB : phase.flowerA} />
          <circle cx="0" cy="-4" r="7" fill={index % 2 ? phase.flowerA : phase.flowerB} />
          <circle cx="0" cy="6" r="5" fill="#fff7cf" />
        </g>
      ))}
    </g>
  );
}

function Rocks({ isNight }: { isNight: boolean }) {
  return (
    <g fill={isNight ? "#315f7a" : "#9ea9a8"} opacity={isNight ? 0.72 : 0.9}>
      <ellipse cx="352" cy="744" rx="34" ry="17" />
      <ellipse cx="1082" cy="686" rx="44" ry="22" />
      <ellipse cx="1324" cy="816" rx="36" ry="18" />
    </g>
  );
}
