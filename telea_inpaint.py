import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


SUPPORTED_FORMATS = {"jpg", "jpeg", "png", "webp"}


def ensure_bgr_and_alpha(image: np.ndarray):
    if image.ndim == 2:
        return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR), None

    channels = image.shape[2]
    if channels == 4:
        bgr = cv2.cvtColor(image, cv2.COLOR_BGRA2BGR)
        alpha = image[:, :, 3]
        return bgr, alpha
    if channels == 3:
        return image, None
    raise SystemExit(f"unsupported image channels: {channels}")


def normalize_mask(mask: np.ndarray, target_shape):
    if mask.shape[:2] != target_shape[:2]:
        mask = cv2.resize(mask, (target_shape[1], target_shape[0]), interpolation=cv2.INTER_NEAREST)

    _, mask_bin = cv2.threshold(mask, 10, 255, cv2.THRESH_BINARY)
    return mask_bin


def save_output(result_bgr: np.ndarray, original_alpha, output_path: Path, fmt: str):
    if original_alpha is not None and fmt == 'png':
        bgra = cv2.cvtColor(result_bgr, cv2.COLOR_BGR2BGRA)
        bgra[:, :, 3] = original_alpha
        rgba = cv2.cvtColor(bgra, cv2.COLOR_BGRA2RGBA)
        Image.fromarray(rgba).save(output_path, format='PNG')
        return

    rgb = cv2.cvtColor(result_bgr, cv2.COLOR_BGR2RGB)
    image = Image.fromarray(rgb)

    if fmt in ('jpg', 'jpeg'):
        image.save(output_path, format='JPEG', quality=92, subsampling=0)
    elif fmt == 'png':
        image.save(output_path, format='PNG')
    elif fmt == 'webp':
        image.save(output_path, format='WEBP', quality=92)
    else:
        raise SystemExit(f'unsupported format: {fmt}')


def main():
    parser = argparse.ArgumentParser(description='Telea FMM inpaint for watermark removal')
    parser.add_argument('--input', required=True)
    parser.add_argument('--mask', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--format', default='jpeg')
    parser.add_argument('--radius', type=float, default=3.0)
    args = parser.parse_args()

    fmt = args.format.lower()
    if fmt not in SUPPORTED_FORMATS:
        raise SystemExit(f'unsupported format: {fmt}')

    input_path = Path(args.input)
    mask_path = Path(args.mask)
    output_path = Path(args.output)

    image = cv2.imread(str(input_path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise SystemExit(f'failed to read input image: {input_path}')

    mask = cv2.imread(str(mask_path), cv2.IMREAD_GRAYSCALE)
    if mask is None:
        raise SystemExit(f'failed to read mask image: {mask_path}')

    image_bgr, original_alpha = ensure_bgr_and_alpha(image)
    mask_bin = normalize_mask(mask, image_bgr.shape)

    if not np.any(mask_bin):
        raise SystemExit('mask is empty after thresholding')

    result = cv2.inpaint(image_bgr, mask_bin, args.radius, cv2.INPAINT_TELEA)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    save_output(result, original_alpha, output_path, fmt)


if __name__ == '__main__':
    main()
