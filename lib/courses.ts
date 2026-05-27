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
    {
      hole: 1, par: 4, handicap: 7,
      tees: [{ name: "Gold", yardage: 424 }, { name: "Blue", yardage: 399 }, { name: "White", yardage: 362 }, { name: "Red", yardage: 310 }],
      imageUrl: `${OG_BASE}/689e539a70fa0d9fbc31e832_1%203052-min.avif`,
      greenImageUrl: "/greens/og/hole-1.png",
    },
    {
      hole: 2, par: 5, handicap: 1,
      tees: [{ name: "Gold", yardage: 527 }, { name: "Blue", yardage: 501 }, { name: "White", yardage: 468 }, { name: "Red", yardage: 420 }],
      imageUrl: `${OG_BASE}/689e539b9b9e23b3dd7b86f9_2%20250607-min.avif`,
      greenImageUrl: "/greens/og/hole-2.png",
    },
    {
      hole: 3, par: 3, handicap: 13,
      tees: [{ name: "Gold", yardage: 185 }, { name: "Blue", yardage: 170 }, { name: "White", yardage: 148 }, { name: "Red", yardage: 120 }],
      imageUrl: `${OG_BASE}/689e539b7c615d2f699b861d_3%20710-min.avif`,
      greenImageUrl: "/greens/og/hole-3.png",
    },
    {
      hole: 4, par: 4, handicap: 11,
      tees: [{ name: "Gold", yardage: 443 }, { name: "Blue", yardage: 415 }, { name: "White", yardage: 385 }, { name: "Red", yardage: 330 }],
      imageUrl: `${OG_BASE}/689e539fc32d9cf250c739c3_4-min.avif`,
      greenImageUrl: "/greens/og/hole-4.png",
    },
    {
      hole: 5, par: 4, handicap: 5,
      tees: [{ name: "Gold", yardage: 388 }, { name: "Blue", yardage: 365 }, { name: "White", yardage: 338 }, { name: "Red", yardage: 290 }],
      imageUrl: `${OG_BASE}/68dac8b20f19d1d723d488f8_5%2092-min.png`,
      greenImageUrl: "/greens/og/hole-5.png",
    },
    {
      hole: 6, par: 5, handicap: 3,
      tees: [{ name: "Gold", yardage: 402 }, { name: "Blue", yardage: 378 }, { name: "White", yardage: 350 }, { name: "Red", yardage: 298 }],
      imageUrl: `${OG_BASE}/689e539a74eabf25efde31fb_6-min.avif`,
      greenImageUrl: "/greens/og/hole-6.png",
    },
    {
      hole: 7, par: 3, handicap: 15,
      tees: [{ name: "Gold", yardage: 570 }, { name: "Blue", yardage: 540 }, { name: "White", yardage: 505 }, { name: "Red", yardage: 445 }],
      imageUrl: `${OG_BASE}/689e539b34350df3e3563e34_7-min.avif`,
      greenImageUrl: "/greens/og/hole-7.png",
    },
    {
      hole: 8, par: 4, handicap: 17,
      tees: [{ name: "Gold", yardage: 162 }, { name: "Blue", yardage: 148 }, { name: "White", yardage: 130 }, { name: "Red", yardage: 105 }],
      imageUrl: `${OG_BASE}/689e539a9e7454aca0270adc_8-min.avif`,
      greenImageUrl: "/greens/og/hole-8.png",
    },
    {
      hole: 9, par: 4, handicap: 9,
      tees: [{ name: "Gold", yardage: 430 }, { name: "Blue", yardage: 405 }, { name: "White", yardage: 375 }, { name: "Red", yardage: 320 }],
      imageUrl: `${OG_BASE}/689e539e6a8725920e25f140_9-min.avif`,
      greenImageUrl: "/greens/og/hole-9.png",
    },
    {
      hole: 10, par: 5, handicap: 2,
      tees: [{ name: "Gold", yardage: 415 }, { name: "Blue", yardage: 390 }, { name: "White", yardage: 360 }, { name: "Red", yardage: 305 }],
      imageUrl: `${OG_BASE}/689e539aa51af0585bc83a24_10-min.avif`,
      greenImageUrl: "/greens/og/hole-10.png",
    },
    {
      hole: 11, par: 4, handicap: 16,
      tees: [{ name: "Gold", yardage: 555 }, { name: "Blue", yardage: 525 }, { name: "White", yardage: 490 }, { name: "Red", yardage: 430 }],
      imageUrl: `${OG_BASE}/689e539c63478e1b4a863dc5_11-min.avif`,
      greenImageUrl: "/greens/og/hole-11.png",
    },
    {
      hole: 12, par: 5, handicap: 6,
      tees: [{ name: "Gold", yardage: 195 }, { name: "Blue", yardage: 178 }, { name: "White", yardage: 155 }, { name: "Red", yardage: 125 }],
      imageUrl: `${OG_BASE}/689e539e8e9cde857ccdcb2a_12-min.avif`,
      greenImageUrl: "/greens/og/hole-12.png",
    },
    {
      hole: 13, par: 4, handicap: 8,
      tees: [{ name: "Gold", yardage: 448 }, { name: "Blue", yardage: 420 }, { name: "White", yardage: 388 }, { name: "Red", yardage: 330 }],
      imageUrl: `${OG_BASE}/689e539e98ef1a4f4389115f_13-min.avif`,
      greenImageUrl: "/greens/og/hole-13.png",
    },
    {
      hole: 14, par: 4, handicap: 4,
      tees: [{ name: "Gold", yardage: 378 }, { name: "Blue", yardage: 355 }, { name: "White", yardage: 328 }, { name: "Red", yardage: 278 }],
      imageUrl: `${OG_BASE}/689e539e9ea3e146ac5304f2_14-min.avif`,
      greenImageUrl: "/greens/og/hole-14.png",
    },
    {
      hole: 15, par: 3, handicap: 12,
      tees: [{ name: "Gold", yardage: 538 }, { name: "Blue", yardage: 510 }, { name: "White", yardage: 478 }, { name: "Red", yardage: 415 }],
      imageUrl: `${OG_BASE}/689e539a2685aeae31f797f2_15-min.avif`,
      greenImageUrl: "/greens/og/hole-15.png",
    },
    {
      hole: 16, par: 4, handicap: 18,
      tees: [{ name: "Gold", yardage: 172 }, { name: "Blue", yardage: 158 }, { name: "White", yardage: 138 }, { name: "Red", yardage: 112 }],
      imageUrl: `${OG_BASE}/689e539b332e7c7ffcd11190_16-min.avif`,
      greenImageUrl: "/greens/og/hole-16.png",
    },
    {
      hole: 17, par: 3, handicap: 14,
      tees: [{ name: "Gold", yardage: 422 }, { name: "Blue", yardage: 398 }, { name: "White", yardage: 368 }, { name: "Red", yardage: 315 }],
      imageUrl: `${OG_BASE}/689e539e031843fb53981124_17-min.avif`,
      greenImageUrl: "/greens/og/hole-17.png",
    },
    {
      hole: 18, par: 4, handicap: 10,
      tees: [{ name: "Gold", yardage: 548 }, { name: "Blue", yardage: 518 }, { name: "White", yardage: 485 }, { name: "Red", yardage: 425 }],
      imageUrl: `${OG_BASE}/689e539b340924d3b5a0719e_18-min.avif`,
      greenImageUrl: "/greens/og/hole-18.png",
    },
  ],
};

export const GRAYS_CROSSING: CourseData = {
  id: "grays-crossing",
  name: "Gray's Crossing",
  shortName: "GC",
  par: 72,
  holes: [
    {
      hole: 1, par: 4, handicap: 13,
      description: "Playing into the prevailing wind, favor the left side. Bunkers protect the right of the green.",
      tees: [{ name: "Tips", yardage: 444 }, { name: "Tahoe", yardage: 410 }, { name: "Stampede", yardage: 375 }, { name: "Donner", yardage: 375 }, { name: "Boca", yardage: 335 }],
      imageUrl: `${GC_BASE}/689998eae938d3c8c9d4b04d_9ef37fb90deb50b5f38ef63a63fc16d1_grays%20img.avif`,
    },
    {
      hole: 2, par: 4, handicap: 11,
      description: "Keep it short of the left fairway bunker. Approach to a green sloping right with bunkers on the left.",
      tees: [{ name: "Tips", yardage: 380 }, { name: "Tahoe", yardage: 348 }, { name: "Stampede", yardage: 348 }, { name: "Donner", yardage: 307 }, { name: "Boca", yardage: 307 }],
      imageUrl: `${GC_BASE}/689e07064d08d5f9a324458a_2.avif`,
    },
    {
      hole: 3, par: 5, handicap: 7,
      description: "Wind at your back — tee it high. Long hitters tempted in two. Bunkers left on second shot.",
      tees: [{ name: "Tips", yardage: 641 }, { name: "Tahoe", yardage: 604 }, { name: "Stampede", yardage: 563 }, { name: "Donner", yardage: 563 }, { name: "Boca", yardage: 452 }],
      imageUrl: `${GC_BASE}/689e0a9c58d3450071d8fa30_3.avif`,
    },
    {
      hole: 4, par: 3, handicap: 15,
      description: "Shortest hole but demands precision. You may be into the wind even if you can't feel it. Favor right.",
      tees: [{ name: "Tips", yardage: 164 }, { name: "Tahoe", yardage: 156 }, { name: "Stampede", yardage: 156 }, { name: "Donner", yardage: 138 }, { name: "Boca", yardage: 138 }],
      imageUrl: `${GC_BASE}/689e0aa16941086da51a441c_4.avif`,
    },
    {
      hole: 5, par: 4, handicap: 3,
      description: "Favor right off the tee. Downhill and downwind — plays shorter. Long is not an option.",
      tees: [{ name: "Tips", yardage: 492 }, { name: "Tahoe", yardage: 457 }, { name: "Stampede", yardage: 381 }, { name: "Donner", yardage: 381 }, { name: "Boca", yardage: 351 }],
      imageUrl: `${GC_BASE}/689e0aa39c48795c1d70d70a_5.avif`,
    },
    {
      hole: 6, par: 4, handicap: 17,
      description: "Reachable par four — classic risk/reward. Carry bunkers right for eagle chance. Green slopes severely back to front.",
      tees: [{ name: "Tips", yardage: 304 }, { name: "Tahoe", yardage: 274 }, { name: "Stampede", yardage: 274 }, { name: "Donner", yardage: 242 }, { name: "Boca", yardage: 242 }],
      imageUrl: `${GC_BASE}/689e0aa777f8ba8946e8bea8_6.avif`,
    },
    {
      hole: 7, par: 5, handicap: 5,
      description: "Downwind — long hitters can attack in two. Favor left side, whole hole slopes right. Shallow well-protected green.",
      tees: [{ name: "Tips", yardage: 642 }, { name: "Tahoe", yardage: 591 }, { name: "Stampede", yardage: 514 }, { name: "Donner", yardage: 514 }, { name: "Boca", yardage: 452 }],
      imageUrl: `${GC_BASE}/689e0a9cc4b9bf7837db7623_7.avif`,
    },
    {
      hole: 8, par: 3, handicap: 13,
      description: "Elevated tee, wind quartering right to left — plays shorter. Bunkers right, pond left. Par is a good score.",
      tees: [{ name: "Tips", yardage: 185 }, { name: "Tahoe", yardage: 178 }, { name: "Stampede", yardage: 178 }, { name: "Donner", yardage: 158 }, { name: "Boca", yardage: 158 }],
      imageUrl: `${GC_BASE}/689e0aa536cea9d78229b263_8.avif`,
    },
    {
      hole: 9, par: 4, handicap: 1,
      description: "Into the wind. Tee shot right bounces left to center. Take enough club uphill — green slopes back to front sharply.",
      tees: [{ name: "Tips", yardage: 474 }, { name: "Tahoe", yardage: 444 }, { name: "Stampede", yardage: 406 }, { name: "Donner", yardage: 406 }, { name: "Boca", yardage: 339 }],
      imageUrl: `${GC_BASE}/689e0aa13ad2d5d5edaa52e2_9.avif`,
    },
    {
      hole: 10, par: 4, handicap: 8,
      description: "Tee shot between bunkers on right. Second shot plays shorter with prevailing wind. One of the toughest greens on course.",
      tees: [{ name: "Tips", yardage: 474 }, { name: "Tahoe", yardage: 455 }, { name: "Stampede", yardage: 372 }, { name: "Donner", yardage: 372 }, { name: "Boca", yardage: 321 }],
      imageUrl: `${GC_BASE}/689e0a9ea1354198d8c94a7d_10.avif`,
    },
    {
      hole: 11, par: 3, handicap: 16,
      description: "Deep, narrow green. Avoid the deep bunker left — terrain feeds left, so favor the right.",
      tees: [{ name: "Tips", yardage: 181 }, { name: "Tahoe", yardage: 163 }, { name: "Stampede", yardage: 152 }, { name: "Donner", yardage: 152 }, { name: "Boca", yardage: 152 }],
      imageUrl: `${GC_BASE}/689e0aa743ab4e5c85675bb7_11.avif`,
    },
    {
      hole: 12, par: 4, handicap: 14,
      description: "Generous landing area. Left side of fairway gives best angle to green guarded by deep bunkers both sides.",
      tees: [{ name: "Tips", yardage: 447 }, { name: "Tahoe", yardage: 413 }, { name: "Stampede", yardage: 413 }, { name: "Donner", yardage: 347 }, { name: "Boca", yardage: 347 }],
      imageUrl: `${GC_BASE}/689e0a9dac2b43046a6266f3_12.avif`,
    },
    {
      hole: 13, par: 4, handicap: 2,
      description: "Into the wind. Water from tee to green. Accuracy at a premium — calculated approach is crucial.",
      tees: [{ name: "Tips", yardage: 442 }, { name: "Tahoe", yardage: 412 }, { name: "Stampede", yardage: 412 }, { name: "Donner", yardage: 380 }, { name: "Boca", yardage: 267 }],
      imageUrl: `${GC_BASE}/689e0a9dfc8b79aebf530e96_13.avif`,
    },
    {
      hole: 14, par: 4, handicap: 18,
      description: "Short par four — long hitters may go for it. Conservative play right of bunkers leaves a wedge to a tricky green.",
      tees: [{ name: "Tips", yardage: 367 }, { name: "Tahoe", yardage: 334 }, { name: "Stampede", yardage: 334 }, { name: "Donner", yardage: 302 }, { name: "Boca", yardage: 302 }],
      imageUrl: `${GC_BASE}/689e0aa1f246c22ade313756_14.avif`,
    },
    {
      hole: 15, par: 5, handicap: 10,
      description: "Reachable par five. Favor right — ball feeds right to left. Shallow, well-protected green on third.",
      tees: [{ name: "Tips", yardage: 561 }, { name: "Tahoe", yardage: 525 }, { name: "Stampede", yardage: 525 }, { name: "Donner", yardage: 491 }, { name: "Boca", yardage: 491 }],
      imageUrl: `${GC_BASE}/689e0aa1242de6565d28964a_15.avif`,
    },
    {
      hole: 16, par: 3, handicap: 6,
      description: "Downhill — plays 1 to 3 clubs shorter. Club selection is everything.",
      tees: [{ name: "Tips", yardage: 242 }, { name: "Tahoe", yardage: 222 }, { name: "Stampede", yardage: 194 }, { name: "Donner", yardage: 194 }, { name: "Boca", yardage: 149 }],
      imageUrl: `${GC_BASE}/689e0aa51014282361f57724_16.avif`,
    },
    {
      hole: 17, par: 4, handicap: 12,
      description: "Wind at back — long hitters may drive through. Tee over left edge of bunker for mid-iron to a fast, firm green.",
      tees: [{ name: "Tips", yardage: 431 }, { name: "Tahoe", yardage: 425 }, { name: "Stampede", yardage: 354 }, { name: "Donner", yardage: 354 }, { name: "Boca", yardage: 314 }],
      imageUrl: `${GC_BASE}/689e0aaabf9c01c6a08490f9_17.avif`,
    },
    {
      hole: 18, par: 5, handicap: 4,
      description: "Into the wind — three shot hole for most. Right-center tee shot. Second shot left to avoid hazard. Long hitters can cut corner.",
      tees: [{ name: "Tips", yardage: 613 }, { name: "Tahoe", yardage: 589 }, { name: "Stampede", yardage: 475 }, { name: "Donner", yardage: 475 }, { name: "Boca", yardage: 414 }],
      imageUrl: `${GC_BASE}/689e0a9f9b5c4642f56f940e_18.avif`,
    },
  ],
};

export const COURSES: Record<string, CourseData> = {
  "old-greenwood": OLD_GREENWOOD,
  "grays-crossing": GRAYS_CROSSING,
};

// Day 1 = Old Greenwood, Day 2 = Gray's Crossing
export function getCourseForDay(day: 1 | 2): CourseData {
  return day === 1 ? OLD_GREENWOOD : GRAYS_CROSSING;
}
