// src/lib/courses.ts

export type TeeSet = {
  name: string;
  yardage: number;
};

export type HoleData = {
  hole: number;
  par: number;
  handicap: number;
  tees: TeeSet[];
  imageUrl: string;
  greenImageUrl?: string;
  description?: string;
};

export type CourseData = {
  id: string;
  name: string;
  shortName: string;
  par: number;
  holes: HoleData[];
};

const OG_BASE = "https://cdn.prod.website-files.com/6837efa2cc391ff85d9b3cfd";
const GC_BASE = "https://cdn.prod.website-files.com/6837efa2cc391ff85d9b3cfd";

export const OLD_GREENWOOD: CourseData = {
  id: "old-greenwood",
  name: "Old Greenwood",
  shortName: "OG",
  par: 72,
  holes: [
    { hole: 1,  par: 4, handicap: 7,  tees: [{ name: "White", yardage: 425 }], imageUrl: `${OG_BASE}/689e539a70fa0d9fbc31e832_1%203052-min.avif`,      greenImageUrl: "/greens/og/hole-1.png" },
    { hole: 2,  par: 5, handicap: 1,  tees: [{ name: "White", yardage: 564 }], imageUrl: `${OG_BASE}/689e539b9b9e23b3dd7b86f9_2%20250607-min.avif`,    greenImageUrl: "/greens/og/hole-2.png" },
    { hole: 3,  par: 3, handicap: 13, tees: [{ name: "White", yardage: 139 }], imageUrl: `${OG_BASE}/689e539b7c615d2f699b861d_3%20710-min.avif`,        greenImageUrl: "/greens/og/hole-3.png" },
    { hole: 4,  par: 4, handicap: 11, tees: [{ name: "White", yardage: 363 }], imageUrl: `${OG_BASE}/689e539fc32d9cf250c739c3_4-min.avif`,              greenImageUrl: "/greens/og/hole-4.png" },
    { hole: 5,  par: 4, handicap: 5,  tees: [{ name: "White", yardage: 411 }], imageUrl: `${OG_BASE}/68dac8b20f19d1d723d488f8_5%2092-min.png`,          greenImageUrl: "/greens/og/hole-5.png" },
    { hole: 6,  par: 5, handicap: 3,  tees: [{ name: "White", yardage: 500 }], imageUrl: `${OG_BASE}/689e539a74eabf25efde31fb_6-min.avif`,              greenImageUrl: "/greens/og/hole-6.png" },
    { hole: 7,  par: 3, handicap: 15, tees: [{ name: "White", yardage: 138 }], imageUrl: `${OG_BASE}/689e539b34350df3e3563e34_7-min.avif`,              greenImageUrl: "/greens/og/hole-7.png" },
    { hole: 8,  par: 4, handicap: 17, tees: [{ name: "White", yardage: 334 }], imageUrl: `${OG_BASE}/689e539a9e7454aca0270adc_8-min.avif`,              greenImageUrl: "/greens/og/hole-8.png" },
    { hole: 9,  par: 4, handicap: 9,  tees: [{ name: "White", yardage: 386 }], imageUrl: `${OG_BASE}/689e539e6a8725920e25f140_9-min.avif`,              greenImageUrl: "/greens/og/hole-9.png" },
    { hole: 10, par: 5, handicap: 2,  tees: [{ name: "White", yardage: 540 }], imageUrl: `${OG_BASE}/689e539aa51af0585bc83a24_10-min.avif`,             greenImageUrl: "/greens/og/hole-10.png" },
    { hole: 11, par: 4, handicap: 16, tees: [{ name: "White", yardage: 330 }], imageUrl: `${OG_BASE}/689e539c63478e1b4a863dc5_11-min.avif`,             greenImageUrl: "/greens/og/hole-11.png" },
    { hole: 12, par: 5, handicap: 6,  tees: [{ name: "White", yardage: 493 }], imageUrl: `${OG_BASE}/689e539e8e9cde857ccdcb2a_12-min.avif`,             greenImageUrl: "/greens/og/hole-12.png" },
    { hole: 13, par: 4, handicap: 8,  tees: [{ name: "White", yardage: 429 }], imageUrl: `${OG_BASE}/689e539e98ef1a4f4389115f_13-min.avif`,             greenImageUrl: "/greens/og/hole-13.png" },
    { hole: 14, par: 4, handicap: 4,  tees: [{ name: "White", yardage: 426 }], imageUrl: `${OG_BASE}/689e539e9ea3e146ac5304f2_14-min.avif`,             greenImageUrl: "/greens/og/hole-14.png" },
    { hole: 15, par: 3, handicap: 12, tees: [{ name: "White", yardage: 171 }], imageUrl: `${OG_BASE}/689e539a2685aeae31f797f2_15-min.avif`,             greenImageUrl: "/greens/og/hole-15.png" },
    { hole: 16, par: 4, handicap: 18, tees: [{ name: "White", yardage: 369 }], imageUrl: `${OG_BASE}/689e539b332e7c7ffcd11190_16-min.avif`,             greenImageUrl: "/greens/og/hole-16.png" },
    { hole: 17, par: 3, handicap: 14, tees: [{ name: "White", yardage: 182 }], imageUrl: `${OG_BASE}/689e539e031843fb53981124_17-min.avif`,             greenImageUrl: "/greens/og/hole-17.png" },
    { hole: 18, par: 4, handicap: 10, tees: [{ name: "White", yardage: 397 }], imageUrl: `${OG_BASE}/689e539b340924d3b5a0719e_18-min.avif`,             greenImageUrl: "/greens/og/hole-18.png" },
  ],
};

export const GRAYS_CROSSING: CourseData = {
  id: "grays-crossing",
  name: "Gray's Crossing",
  shortName: "GC",
  par: 72,
  holes: [
    { hole: 1,  par: 4, handicap: 13, tees: [{ name: "Stampede", yardage: 410 }], description: "Playing into the prevailing wind, favor the left side. Bunkers protect the right of the green.", imageUrl: `${GC_BASE}/689998eae938d3c8c9d4b04d_9ef37fb90deb50b5f38ef63a63fc16d1_grays%20img.avif`, greenImageUrl: "/greens/gc/hole-1.png" },
    { hole: 2,  par: 4, handicap: 11, tees: [{ name: "Stampede", yardage: 348 }], description: "Keep it short of the left fairway bunker. Approach to a green sloping right with bunkers on the left.", imageUrl: `${GC_BASE}/689e07064d08d5f9a324458a_2.avif`, greenImageUrl: "/greens/gc/hole-2.png" },
    { hole: 3,  par: 5, handicap: 7,  tees: [{ name: "Stampede", yardage: 563 }], description: "Wind at your back — tee it high. Long hitters tempted in two. Bunkers left on second shot.", imageUrl: `${GC_BASE}/689e0a9c58d3450071d8fa30_3.avif`, greenImageUrl: "/greens/gc/hole-3.png" },
    { hole: 4,  par: 3, handicap: 15, tees: [{ name: "Stampede", yardage: 156 }], description: "Shortest hole but demands precision. You may be into the wind even if you can't feel it. Favor right.", imageUrl: `${GC_BASE}/689e0aa16941086da51a441c_4.avif`, greenImageUrl: "/greens/gc/hole-4.png" },
    { hole: 5,  par: 4, handicap: 3,  tees: [{ name: "Stampede", yardage: 421 }], description: "Favor right off the tee. Downhill and downwind — plays shorter. Long is not an option.", imageUrl: `${GC_BASE}/689e0aa39c48795c1d70d70a_5.avif`, greenImageUrl: "/greens/gc/hole-5.png" },
    { hole: 6,  par: 4, handicap: 17, tees: [{ name: "Stampede", yardage: 274 }], description: "Reachable par four — classic risk/reward. Carry bunkers right for eagle chance. Green slopes severely back to front.", imageUrl: `${GC_BASE}/689e0aa777f8ba8946e8bea8_6.avif`, greenImageUrl: "/greens/gc/hole-6.png" },
    { hole: 7,  par: 5, handicap: 5,  tees: [{ name: "Stampede", yardage: 591 }], description: "Downwind — long hitters can attack in two. Favor left side, whole hole slopes right. Shallow well-protected green.", imageUrl: `${GC_BASE}/689e0a9cc4b9bf7837db7623_7.avif`, greenImageUrl: "/greens/gc/hole-7.png" },
    { hole: 8,  par: 3, handicap: 9,  tees: [{ name: "Stampede", yardage: 178 }], description: "Elevated tee, wind quartering right to left — plays shorter. Bunkers right, pond left. Par is a good score.", imageUrl: `${GC_BASE}/689e0aa536cea9d78229b263_8.avif`, greenImageUrl: "/greens/gc/hole-8.png" },
    { hole: 9,  par: 4, handicap: 1,  tees: [{ name: "Stampede", yardage: 406 }], description: "Into the wind. Tee shot right bounces left to center. Take enough club uphill — green slopes back to front sharply.", imageUrl: `${GC_BASE}/689e0aa13ad2d5d5edaa52e2_9.avif`, greenImageUrl: "/greens/gc/hole-9.png" },
    { hole: 10, par: 4, handicap: 8,  tees: [{ name: "Stampede", yardage: 372 }], description: "Tee shot between bunkers on right. Second shot plays shorter with prevailing wind. One of the toughest greens on course.", imageUrl: `${GC_BASE}/689e0a9ea1354198d8c94a7d_10.avif`, greenImageUrl: "/greens/gc/hole-10.png" },
    { hole: 11, par: 3, handicap: 16, tees: [{ name: "Stampede", yardage: 152 }], description: "Deep, narrow green. Avoid the deep bunker left — terrain feeds left, so favor the right.", imageUrl: `${GC_BASE}/689e0aa743ab4e5c85675bb7_11.avif`, greenImageUrl: "/greens/gc/hole-11.png" },
    { hole: 12, par: 4, handicap: 14, tees: [{ name: "Stampede", yardage: 413 }], description: "Generous landing area. Left side of fairway gives best angle to green guarded by deep bunkers both sides.", imageUrl: `${GC_BASE}/689e0a9dac2b43046a6266f3_12.avif`, greenImageUrl: "/greens/gc/hole-12.png" },
    { hole: 13, par: 4, handicap: 2,  tees: [{ name: "Stampede", yardage: 412 }], description: "Into the wind. Water from tee to green. Accuracy at a premium — calculated approach is crucial.", imageUrl: `${GC_BASE}/689e0a9dfc8b79aebf530e96_13.avif`, greenImageUrl: "/greens/gc/hole-13.png" },
    { hole: 14, par: 4, handicap: 18, tees: [{ name: "Stampede", yardage: 334 }], description: "Short par four — long hitters may go for it. Conservative play right of bunkers leaves a wedge to a tricky green.", imageUrl: `${GC_BASE}/689e0aa1f246c22ade313756_14.avif`, greenImageUrl: "/greens/gc/hole-14.png" },
    { hole: 15, par: 5, handicap: 10, tees: [{ name: "Stampede", yardage: 525 }], description: "Reachable par five. Favor right — ball feeds right to left. Shallow, well-protected green on third.", imageUrl: `${GC_BASE}/689e0aa1242de6565d28964a_15.avif`, greenImageUrl: "/greens/gc/hole-15.png" },
    { hole: 16, par: 3, handicap: 6,  tees: [{ name: "Stampede", yardage: 194 }], description: "Downhill — plays 1 to 3 clubs shorter. Club selection is everything.", imageUrl: `${GC_BASE}/689e0aa51014282361f57724_16.avif`, greenImageUrl: "/greens/gc/hole-16.png" },
    { hole: 17, par: 4, handicap: 12, tees: [{ name: "Stampede", yardage: 354 }], description: "Wind at back — long hitters may drive through. Tee over left edge of bunker for mid-iron to a fast, firm green.", imageUrl: `${GC_BASE}/689e0aaabf9c01c6a08490f9_17.avif`, greenImageUrl: "/greens/gc/hole-17.png" },
    { hole: 18, par: 5, handicap: 4,  tees: [{ name: "Stampede", yardage: 475 }], description: "Into the wind — three shot hole for most. Right-center tee shot. Second shot left to avoid hazard. Long hitters can cut corner.", imageUrl: `${GC_BASE}/689e0a9f9b5c4642f56f940e_18.avif`, greenImageUrl: "/greens/gc/hole-18.png" },
  ],
};

export const HILLS: CourseData = {
  id: "hills",
  name: "Hills at Resort at Red Hawk",
  shortName: "RH",
  par: 71,
  holes: [
    {
      hole: 1, par: 5, handicap: 7,
      tees: [{ name: "Blue", yardage: 490 }],
      imageUrl: "/greens/rh/hole-1-yardage.png",
      greenImageUrl: "/greens/rh/hole-1-green.png",
    },
    {
      hole: 2, par: 4, handicap: 3,
      tees: [{ name: "Blue", yardage: 355 }],
      imageUrl: "/greens/rh/hole-2-yardage.png",
      greenImageUrl: "/greens/rh/hole-2-green.png",
    },
    {
      hole: 3, par: 4, handicap: 11,
      tees: [{ name: "Blue", yardage: 302 }],
      imageUrl: "/greens/rh/hole-3-yardage.png",
      greenImageUrl: "/greens/rh/hole-3-green.png",
    },
    {
      hole: 4, par: 4, handicap: 17,
      tees: [{ name: "Blue", yardage: 332 }],
      imageUrl: "/greens/rh/hole-4-yardage.png",
      greenImageUrl: "/greens/rh/hole-4-green.png",
    },
    {
      hole: 5, par: 3, handicap: 13,
      tees: [{ name: "Blue", yardage: 128 }],
      imageUrl: "/greens/rh/hole-5-yardage.png",
      greenImageUrl: "/greens/rh/hole-5-green.png",
    },
    {
      hole: 6, par: 4, handicap: 1,
      tees: [{ name: "Blue", yardage: 456 }],
      imageUrl: "/greens/rh/hole-6-yardage.png",
      greenImageUrl: "/greens/rh/hole-6-green.png",
    },
    {
      hole: 7, par: 3, handicap: 15,
      tees: [{ name: "Blue", yardage: 128 }],
      imageUrl: "/greens/rh/hole-7-yardage.png",
      greenImageUrl: "/greens/rh/hole-7-green.png",
    },
    {
      hole: 8, par: 5, handicap: 5,
      tees: [{ name: "Blue", yardage: 481 }],
      imageUrl: "/greens/rh/hole-8-yardage.png",
      greenImageUrl: "/greens/rh/hole-8-green.png",
    },
    {
      hole: 9, par: 4, handicap: 9,
      tees: [{ name: "Blue", yardage: 282 }],
      imageUrl: "/greens/rh/hole-9-yardage.png",
      greenImageUrl: "/greens/rh/hole-9-green.png",
    },
    {
      hole: 10, par: 5, handicap: 14,
      tees: [{ name: "Blue", yardage: 586 }],
      imageUrl: "/greens/rh/hole-10-yardage.png",
      greenImageUrl: "/greens/rh/hole-10-green.png",
    },
    {
      hole: 11, par: 3, handicap: 10,
      tees: [{ name: "Blue", yardage: 213 }],
      imageUrl: "/greens/rh/hole-11-yardage.png",
      greenImageUrl: "/greens/rh/hole-11-green.png",
    },
    {
      hole: 12, par: 4, handicap: 16,
      tees: [{ name: "Blue", yardage: 386 }],
      imageUrl: "/greens/rh/hole-12-yardage.png",
      greenImageUrl: "/greens/rh/hole-12-green.png",
    },
    {
      hole: 13, par: 3, handicap: 18,
      tees: [{ name: "Blue", yardage: 125 }],
      imageUrl: "/greens/rh/hole-13-yardage.png",
      greenImageUrl: "/greens/rh/hole-13-green.png",
    },
    {
      hole: 14, par: 4, handicap: 2,
      tees: [{ name: "Blue", yardage: 360 }],
      imageUrl: "/greens/rh/hole-14-yardage.png",
      greenImageUrl: "/greens/rh/hole-14-green.png",
    },
    {
      hole: 15, par: 4, handicap: 8,
      tees: [{ name: "Blue", yardage: 355 }],
      imageUrl: "/greens/rh/hole-15-yardage.png",
      greenImageUrl: "/greens/rh/hole-15-green.png",
    },
    {
      hole: 16, par: 4, handicap: 4,
      tees: [{ name: "Blue", yardage: 440 }],
      imageUrl: "/greens/rh/hole-16-yardage.png",
      greenImageUrl: "/greens/rh/hole-16-green.png",
    },
    {
      hole: 17, par: 4, handicap: 12,
      tees: [{ name: "Blue", yardage: 407 }],
      imageUrl: "/greens/rh/hole-17-yardage.png",
      greenImageUrl: "/greens/rh/hole-17-green.png",
    },
    {
      hole: 18, par: 4, handicap: 6,
      tees: [{ name: "Blue", yardage: 418 }],
      imageUrl: "/greens/rh/hole-18-yardage.png",
      greenImageUrl: "/greens/rh/hole-18-green.png",
    },
  ],
};

// ─── Fall Series courses ─────────────────────────────────────────────────────
// Scorecard data from White (middle men's) tees. No hole photos are available
// for these municipal courses; imageUrl is left blank and the scoring page
// renders a gradient placeholder that keeps the Old Greenwood / Gray's Crossing
// layout intact.

const BRE_GREEN = (n: number) => `/greens/bre/hole-${n}.png`;

export const BLUE_ROCK_EAST: CourseData = {
  id: "blue-rock-east",
  name: "Blue Rock Springs East",
  shortName: "BRE",
  par: 70,
  holes: [
    { hole: 1,  par: 4, handicap: 9,  tees: [{ name: "White", yardage: 343 }], imageUrl: BRE_GREEN(1),  greenImageUrl: BRE_GREEN(1) },
    { hole: 2,  par: 3, handicap: 17, tees: [{ name: "White", yardage: 141 }], imageUrl: BRE_GREEN(2),  greenImageUrl: BRE_GREEN(2) },
    { hole: 3,  par: 4, handicap: 7,  tees: [{ name: "White", yardage: 344 }], imageUrl: BRE_GREEN(3),  greenImageUrl: BRE_GREEN(3) },
    { hole: 4,  par: 4, handicap: 3,  tees: [{ name: "White", yardage: 358 }], imageUrl: BRE_GREEN(4),  greenImageUrl: BRE_GREEN(4) },
    { hole: 5,  par: 5, handicap: 1,  tees: [{ name: "White", yardage: 473 }], imageUrl: BRE_GREEN(5),  greenImageUrl: BRE_GREEN(5) },
    { hole: 6,  par: 3, handicap: 11, tees: [{ name: "White", yardage: 148 }], imageUrl: BRE_GREEN(6),  greenImageUrl: BRE_GREEN(6) },
    { hole: 7,  par: 5, handicap: 13, tees: [{ name: "White", yardage: 502 }], imageUrl: BRE_GREEN(7),  greenImageUrl: BRE_GREEN(7) },
    { hole: 8,  par: 3, handicap: 15, tees: [{ name: "White", yardage: 104 }], imageUrl: BRE_GREEN(8),  greenImageUrl: BRE_GREEN(8) },
    { hole: 9,  par: 4, handicap: 5,  tees: [{ name: "White", yardage: 367 }], imageUrl: BRE_GREEN(9),  greenImageUrl: BRE_GREEN(9) },
    { hole: 10, par: 4, handicap: 12, tees: [{ name: "White", yardage: 319 }], imageUrl: BRE_GREEN(10), greenImageUrl: BRE_GREEN(10) },
    { hole: 11, par: 3, handicap: 16, tees: [{ name: "White", yardage: 130 }], imageUrl: BRE_GREEN(11), greenImageUrl: BRE_GREEN(11) },
    { hole: 12, par: 4, handicap: 4,  tees: [{ name: "White", yardage: 342 }], imageUrl: BRE_GREEN(12), greenImageUrl: BRE_GREEN(12) },
    { hole: 13, par: 4, handicap: 10, tees: [{ name: "White", yardage: 366 }], imageUrl: BRE_GREEN(13), greenImageUrl: BRE_GREEN(13) },
    { hole: 14, par: 5, handicap: 18, tees: [{ name: "White", yardage: 542 }], imageUrl: BRE_GREEN(14), greenImageUrl: BRE_GREEN(14) },
    { hole: 15, par: 4, handicap: 2,  tees: [{ name: "White", yardage: 406 }], imageUrl: BRE_GREEN(15), greenImageUrl: BRE_GREEN(15) },
    { hole: 16, par: 3, handicap: 14, tees: [{ name: "White", yardage: 137 }], imageUrl: BRE_GREEN(16), greenImageUrl: BRE_GREEN(16) },
    { hole: 17, par: 4, handicap: 6,  tees: [{ name: "White", yardage: 391 }], imageUrl: BRE_GREEN(17), greenImageUrl: BRE_GREEN(17) },
    { hole: 18, par: 4, handicap: 8,  tees: [{ name: "White", yardage: 363 }], imageUrl: BRE_GREEN(18), greenImageUrl: BRE_GREEN(18) },
  ],
};

export const SUNNYVALE: CourseData = {
  id: "sunnyvale",
  name: "Sunnyvale Golf Course",
  shortName: "SUN",
  par: 70,
  holes: [
    { hole: 1,  par: 4, handicap: 7,  tees: [{ name: "White", yardage: 351 }], imageUrl: "" },
    { hole: 2,  par: 4, handicap: 5,  tees: [{ name: "White", yardage: 362 }], imageUrl: "" },
    { hole: 3,  par: 5, handicap: 11, tees: [{ name: "White", yardage: 478 }], imageUrl: "" },
    { hole: 4,  par: 3, handicap: 15, tees: [{ name: "White", yardage: 142 }], imageUrl: "" },
    { hole: 5,  par: 4, handicap: 17, tees: [{ name: "White", yardage: 281 }], imageUrl: "" },
    { hole: 6,  par: 4, handicap: 9,  tees: [{ name: "White", yardage: 354 }], imageUrl: "" },
    { hole: 7,  par: 3, handicap: 13, tees: [{ name: "White", yardage: 129 }], imageUrl: "" },
    { hole: 8,  par: 4, handicap: 1,  tees: [{ name: "White", yardage: 309 }], imageUrl: "" },
    { hole: 9,  par: 4, handicap: 3,  tees: [{ name: "White", yardage: 402 }], imageUrl: "" },
    { hole: 10, par: 5, handicap: 14, tees: [{ name: "White", yardage: 530 }], imageUrl: "" },
    { hole: 11, par: 4, handicap: 8,  tees: [{ name: "White", yardage: 383 }], imageUrl: "" },
    { hole: 12, par: 4, handicap: 18, tees: [{ name: "White", yardage: 362 }], imageUrl: "" },
    { hole: 13, par: 3, handicap: 16, tees: [{ name: "White", yardage: 161 }], imageUrl: "" },
    { hole: 14, par: 4, handicap: 12, tees: [{ name: "White", yardage: 342 }], imageUrl: "" },
    { hole: 15, par: 3, handicap: 6,  tees: [{ name: "White", yardage: 171 }], imageUrl: "" },
    { hole: 16, par: 4, handicap: 2,  tees: [{ name: "White", yardage: 306 }], imageUrl: "" },
    { hole: 17, par: 4, handicap: 10, tees: [{ name: "White", yardage: 350 }], imageUrl: "" },
    { hole: 18, par: 4, handicap: 4,  tees: [{ name: "White", yardage: 329 }], imageUrl: "" },
  ],
};

export const COURSES: Record<string, CourseData> = {
  "old-greenwood": OLD_GREENWOOD,
  "grays-crossing": GRAYS_CROSSING,
  "hills": HILLS,
  "blue-rock-east": BLUE_ROCK_EAST,
  "sunnyvale": SUNNYVALE,
};

// Day 1 = Old Greenwood, Day 2 = Gray's Crossing
export function getCourseForDay(day: 1 | 2): CourseData {
  return day === 1 ? OLD_GREENWOOD : GRAYS_CROSSING;
}
