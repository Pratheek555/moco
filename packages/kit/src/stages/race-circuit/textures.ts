// Every surface texture is drawn in code: nothing to download, nothing to license.
import * as THREE from "three";

function canvasTexture(width: number, height: number, draw: (context: CanvasRenderingContext2D) => void, repeat: [number, number] = [1, 1]): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

// A seeded generator, so the same frame always renders the same pixels (Remotion renders frames out of order).
export function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

// Speckled tarmac with a white edge line each side and darker racing-line rubber down the middle.
export const asphalt = () =>
  canvasTexture(512, 512, (context) => {
    const random = seededRandom(7);
    context.fillStyle = "#54565c";
    context.fillRect(0, 0, 512, 512);
    Array.from({ length: 26000 }).forEach(() => {
      const shade = 60 + random() * 48;
      context.fillStyle = `rgb(${shade},${shade},${shade + 3})`;
      context.fillRect(random() * 512, random() * 512, 2, 2);
    });
    const rubber = context.createLinearGradient(0, 0, 512, 0);
    rubber.addColorStop(0.2, "rgba(10,10,12,0)");
    rubber.addColorStop(0.5, "rgba(30,30,34,0.5)");
    rubber.addColorStop(0.8, "rgba(10,10,12,0)");
    context.fillStyle = rubber;
    context.fillRect(0, 0, 512, 512);
    context.fillStyle = "#e8e8e4";
    context.fillRect(6, 0, 9, 512);
    context.fillRect(497, 0, 9, 512);
  }, [1, 1 / 24]);

// The start and finish line, chequered.
export const chequers = () =>
  canvasTexture(16, 128, (context) => {
    context.fillStyle = "#f2f2ee";
    context.fillRect(0, 0, 16, 128);
    context.fillStyle = "#15161a";
    Array.from({ length: 16 }).forEach((_, index) => {
      context.fillRect(((index + (index >> 1)) % 2) * 8, index * 8, 8, 8);
    });
  });

export const kerb = () =>
  canvasTexture(16, 64, (context) => {
    context.fillStyle = "#e5e3dc";
    context.fillRect(0, 0, 16, 64);
    context.fillStyle = "#c81e26";
    context.fillRect(0, 0, 16, 32);
  }, [1, 1 / 3]);

export const grass = () =>
  canvasTexture(256, 256, (context) => {
    const random = seededRandom(11);
    context.fillStyle = "#31502c";
    context.fillRect(0, 0, 256, 256);
    Array.from({ length: 12000 }).forEach(() => {
      context.fillStyle = `rgba(${30 + random() * 50},${70 + random() * 60},${30 + random() * 30},0.5)`;
      context.fillRect(random() * 256, random() * 256, 2, 2);
    });
  }, [160, 160]);

// Barrier advertising, all invented: colour blocks with fictional names.
export const banners = () =>
  canvasTexture(64, 1024, (context) => {
    const blocks = [["#0f2c5c", "SABINE"], ["#e8e8e4", "KESTREL"], ["#b3121d", "AURELION"], ["#14181f", "PORT"]];
    blocks.forEach(([colour, name], index) => {
      context.save();
      context.fillStyle = colour!;
      context.fillRect(0, index * 256, 64, 256);
      // u runs up the barrier, so the text stands upright when rotated this way.
      context.translate(20, index * 256 + 28);
      context.rotate(Math.PI / 2);
      context.fillStyle = colour === "#e8e8e4" ? "#14181f" : "#ffffff";
      context.font = "900 38px Arial";
      context.fillText(name!, 0, 0);
      context.restore();
    });
  }, [1, 1 / 40]);

export const windows = () =>
  canvasTexture(128, 256, (context) => {
    const random = seededRandom(3);
    context.fillStyle = "#1a1c26";
    context.fillRect(0, 0, 128, 256);
    Array.from({ length: 16 * 32 }).forEach((_, index) => {
      if (random() < 0.45) return; // an unlit window
      context.fillStyle = random() < 0.5 ? "#ffcf87" : "#ffe8bd";
      context.fillRect((index % 16) * 8 + 2, Math.floor(index / 16) * 8 + 2, 4, 5);
    });
  });

export const raceNumber = (number: string, ink: string) =>
  canvasTexture(128, 128, (context) => {
    context.fillStyle = ink;
    context.font = "italic 900 92px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(number, 64, 68);
  });
