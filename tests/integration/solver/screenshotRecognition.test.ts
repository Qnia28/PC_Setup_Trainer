import { describe, expect, it } from "vitest";
import { recognizeScreenshot, type Raster } from "../../../src/solverPage/imageRecognition";

function screenshot(gamma = 1, omitLastNext = false, transparent = false, seams = false): Raster {
  const width = 470, height = 570, data = new Uint8ClampedArray(width * height * 4);
  function rect(x: number, y: number, w: number, h: number, rgb: number[]) {
    for (let dy = y; dy < y + h; dy++) for (let dx = x; dx < x + w; dx++) {
      const index = (dy * width + dx) * 4;
      for (let c = 0; c < 3; c++) data[index + c] = 255 * (rgb[c]! / 255) ** gamma;
      data[index + 3] = 255;
    }
  }
  const shapes = {
    T: [[1,0],[0,1],[1,1],[2,1]], O: [[0,0],[1,0],[0,1],[1,1]],
    L: [[2,0],[0,1],[1,1],[2,1]], I: [[0,0],[1,0],[2,0],[3,0]],
    J: [[0,0],[0,1],[1,1],[2,1]], S: [[1,0],[2,0],[0,1],[1,1]],
  };
  function piece(key: keyof typeof shapes, x: number, y: number, rgb = [220, 45, 235]) {
    for (const [dx,dy] of shapes[key]) rect(x + dx! * 20, y + dy! * 20, seams ? 19 : 20, seams ? 19 : 20, rgb);
  }
  rect(0,0,width,height,transparent ? [119,75,115] : [0,0,0]);
  if (transparent) {
    // A colored sky behind the active piece, a tinted gradient through the grid,
    // and a neighboring meter frame. No source screenshots/palettes are used.
    for (let row = 0; row < 400; row++) {
      const tint = Math.round(35 + row / 30);
      rect(140,60+row,201,1,[tint,tint-5,tint-2]);
    }
    rect(125,60,2,401,[180,180,180]);
  }
  for(let x=0;x<=10;x++) rect(140+x*20,60,1,401,[70,70,70]);
  for(let y=0;y<=20;y++) rect(140,60+y*20,201,1,[70,70,70]);
  piece("T",200,transparent ? 15 : 60);
  piece("O",70,80,[235,210,20]);
  (["L","I","J","L","S"] as const).forEach((p,i)=> { if(!omitLastNext || i!==4) piece(p,370,80+i*65); });
  piece("O",140,420,[235,210,20]);
  piece("T",200,420,[85,15,95]);
  return {width,height,data};
}

describe("original screenshot recognizer", () => {
  it.each([.8,1,1.35])("separates a same-hue sky and translucent grid at gamma %s", gamma => {
    const result = recognizeScreenshot(screenshot(gamma, false, true));
    expect(result.queue).toBe("OTLIJLS");
    expect(result.field.map(row => row.map(Boolean))).toEqual([
      [true,true,false,false,false,false,false,false,false,false],
      [true,true,false,false,false,false,false,false,false,false],
      ...Array.from({length:4}, () => Array<boolean>(10).fill(false)),
    ]);
  });
  it("joins narrow tile seams without merging repeated NEXT pieces", () => {
    const result = recognizeScreenshot(screenshot(1.35, false, true, true));
    expect(result.next).toEqual(["L","I","J","L","S"]);
    expect(result.queue).toBe("OTLIJLS");
    expect(result.field.flat().filter(Boolean)).toHaveLength(4);
  });
  it("still rejects two distinct boards", () => {
    const single = screenshot();
    const data = new Uint8ClampedArray(single.data.length * 2);
    for (let y = 0; y < single.height; y++) {
      const row = single.data.subarray(y * single.width * 4, (y + 1) * single.width * 4);
      data.set(row, y * single.width * 8);
      data.set(row, y * single.width * 8 + single.width * 4);
    }
    expect(() => recognizeScreenshot({width:single.width*2,height:single.height,data})).toThrow("Multiple boards");
  });
  it.each([.8,1,1.35])("reads geometry and excludes ghosts at gamma %s", gamma => {
    const result = recognizeScreenshot(screenshot(gamma));
    expect(result.queue).toBe("OTLIJLS");
    expect(result.field.flat().filter(Boolean)).toHaveLength(4);
    expect(result.field[0]!.slice(0,2)).toEqual([true,true]);
    expect(result.field[1]!.slice(0,2)).toEqual([true,true]);
  });
  it("does not silently shorten an unreadable NEXT queue", () => {
    expect(() => recognizeScreenshot(screenshot(1,true))).toThrow("five NEXT");
  });
  it("rejects an inconsistent occupied-cell count", () => {
    const image = screenshot();
    for (let y=441;y<460;y++) for(let x=321;x<340;x++) {
      const i=(y*image.width+x)*4;
      image.data[i]=235; image.data[i+1]=210; image.data[i+2]=20;
    }
    expect(() => recognizeScreenshot(image)).toThrow("inconsistent");
  });
  it("rejects blank and oversized images", () => {
    expect(() => recognizeScreenshot({width:500,height:600,data:new Uint8ClampedArray(500*600*4)})).toThrow("grid");
    expect(() => recognizeScreenshot({width:4000,height:4000,data:new Uint8ClampedArray()})).toThrow("megapixels");
  });
});
