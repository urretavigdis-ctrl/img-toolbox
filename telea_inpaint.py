import argparse
import json
import sys
from pathlib import Path


def dependency_error(package_name: str, import_error: Exception):
    raise SystemExit(
        f"missing python dependency: {package_name}. "
        f"请先在项目目录虚拟环境安装 requirements.txt。原始错误: {import_error}"
    )


try:
    import cv2
except Exception as exc:  # pragma: no cover - import failure path
    dependency_error("opencv-python-headless / cv2", exc)

try:
    import numpy as np
except Exception as exc:  # pragma: no cover - import failure path
    dependency_error("numpy", exc)

try:
    from PIL import Image
except Exception as exc:  # pragma: no cover - import failure path
    dependency_error("Pillow", exc)


SUPPORTED_FORMATS = {"jpg", "jpeg", "png", "webp"}
MASK_THRESHOLD = 10
MIN_BLEND_KERNEL = 3
MAX_BLEND_KERNEL = 15


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

    _, mask_bin = cv2.threshold(mask, MASK_THRESHOLD, 255, cv2.THRESH_BINARY)
    return mask_bin


def expand_inpaint_mask(mask_bin: np.ndarray):
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    return cv2.dilate(mask_bin, kernel, iterations=1)


def build_blend_mask(mask_bin: np.ndarray, radius: float):
    blur_size = int(round(max(MIN_BLEND_KERNEL, min(MAX_BLEND_KERNEL, radius * 2 + 1))))
    if blur_size % 2 == 0:
        blur_size += 1

    blurred = cv2.GaussianBlur(mask_bin, (blur_size, blur_size), 0)
    return blurred.astype(np.float32) / 255.0


def blend_edges(original_bgr: np.ndarray, repaired_bgr: np.ndarray, blend_mask: np.ndarray):
    alpha = np.clip(blend_mask, 0.0, 1.0)[..., None]
    blended = (original_bgr.astype(np.float32) * (1.0 - alpha)) + (repaired_bgr.astype(np.float32) * alpha)
    return np.clip(blended, 0, 255).astype(np.uint8)


def read_mask(mask_path: Path):
    raw = cv2.imread(str(mask_path), cv2.IMREAD_UNCHANGED)
    if raw is None:
        raise SystemExit(f"failed to read mask image: {mask_path}")

    if raw.ndim == 2:
        return raw

    channels = raw.shape[2]
    if channels == 4:
        alpha = raw[:, :, 3]
        rgb = cv2.cvtColor(raw, cv2.COLOR_BGRA2GRAY)
        # 兼容两类前端导出：
        # 1) 透明底 + 白色前景（alpha 才是真正 mask）
        # 2) 黑底/白底的灰度导出（rgb 里有前景）
        # 不能直接对整张图取 maximum(rgb, alpha)，否则不透明黑底会把整张图抬成全白。
        return np.where(alpha > 8, 255, rgb).astype(np.uint8)
    if channels == 3:
        return cv2.cvtColor(raw, cv2.COLOR_BGR2GRAY)

    raise SystemExit(f"unsupported mask channels: {channels}")


def estimate_background_smoothness(image_bgr: np.ndarray, mask_bin: np.ndarray, radius: float):
    kernel = max(3, int(round(radius * 4)))
    if kernel % 2 == 0:
        kernel += 1

    dilated = cv2.dilate(mask_bin, np.ones((kernel, kernel), dtype=np.uint8), iterations=1)
    ring = cv2.subtract(dilated, mask_bin)
    ring_pixels = int(np.count_nonzero(ring))
    if ring_pixels < 64:
        return False, 999.0

    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    lap = cv2.Laplacian(gray, cv2.CV_32F, ksize=3)
    values = np.abs(lap[ring > 0])
    if values.size == 0:
        return False, 999.0

    score = float(np.mean(values))
    return score < 6.0, score


def smooth_fill_before_inpaint(image_bgr: np.ndarray, mask_bin: np.ndarray, radius: float):
    kernel = max(5, int(round(radius * 3)))
    if kernel % 2 == 0:
        kernel += 1

    blurred = cv2.GaussianBlur(image_bgr, (kernel, kernel), sigmaX=0, sigmaY=0)
    feather = cv2.dilate(mask_bin, np.ones((3, 3), dtype=np.uint8), iterations=1)
    result = image_bgr.copy()
    blend = (feather.astype(np.float32) / 255.0)[:, :, None]
    mixed = (blurred.astype(np.float32) * blend) + (image_bgr.astype(np.float32) * (1.0 - blend))
    result[feather > 0] = np.clip(mixed[feather > 0], 0, 255).astype(np.uint8)
    return result


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


def validate_args(args):
    fmt = args.format.lower()
    if fmt not in SUPPORTED_FORMATS:
        raise SystemExit(f'unsupported format: {fmt}')
    if args.radius <= 0:
        raise SystemExit('radius must be > 0')

    input_path = Path(args.input)
    mask_path = Path(args.mask)
    output_path = Path(args.output)

    if not input_path.is_file():
        raise SystemExit(f'input image not found: {input_path}')
    if not mask_path.is_file():
        raise SystemExit(f'mask image not found: {mask_path}')

    return fmt, input_path, mask_path, output_path


def main():
    parser = argparse.ArgumentParser(description='Telea FMM inpaint for watermark removal')
    parser.add_argument('--input', required=True)
    parser.add_argument('--mask', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--format', default='jpeg')
    parser.add_argument('--radius', type=float, default=4.5)
    args = parser.parse_args()

    fmt, input_path, mask_path, output_path = validate_args(args)

    image = cv2.imread(str(input_path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise SystemExit(f'failed to read input image: {input_path}')

    mask = read_mask(mask_path)

    image_bgr, original_alpha = ensure_bgr_and_alpha(image)
    mask_bin = normalize_mask(mask, image_bgr.shape)
    mask_nonzero = int(np.count_nonzero(mask_bin))

    if not mask_nonzero:
        raise SystemExit('mask is empty after thresholding; 请确认蒙版中白色区域就是要去除的水印')

    inpaint_mask = expand_inpaint_mask(mask_bin)
    inpaint_nonzero = int(np.count_nonzero(inpaint_mask))
    smooth_bg, smooth_score = estimate_background_smoothness(image_bgr, inpaint_mask, args.radius)
    effective_radius = args.radius + 1.0 if smooth_bg else args.radius
    working_image = smooth_fill_before_inpaint(image_bgr, inpaint_mask, effective_radius) if smooth_bg else image_bgr
    blend_mask = build_blend_mask(inpaint_mask, effective_radius)

    print(
        f"[imgexe] telea_inpaint input={input_path.name} mask={mask_path.name} "
        f"size={image_bgr.shape[1]}x{image_bgr.shape[0]} mask_nonzero={mask_nonzero} "
        f"expanded_nonzero={inpaint_nonzero}",
        file=sys.stdout,
        flush=True,
    )
    print(
        "[imgexe-meta] " + json.dumps({
            "algo": "telea",
            "radius": round(float(effective_radius), 2),
            "smooth": bool(smooth_bg),
            "smooth_score": round(float(smooth_score), 3),
            "mask_expanded": bool(inpaint_nonzero > mask_nonzero),
            "blend_kernel": int(round(max(MIN_BLEND_KERNEL, min(MAX_BLEND_KERNEL, effective_radius * 2 + 1)))) | 1,
        }, ensure_ascii=False),
        file=sys.stdout,
        flush=True,
    )

    result = cv2.inpaint(working_image, inpaint_mask, effective_radius, cv2.INPAINT_TELEA)
    if result is None or result.size == 0:
        raise SystemExit('opencv inpaint returned empty result')

    result = blend_edges(image_bgr, result, blend_mask)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    save_output(result, original_alpha, output_path, fmt)

    if not output_path.is_file() or output_path.stat().st_size == 0:
        raise SystemExit(f'output image was not created: {output_path}')


if __name__ == '__main__':
    try:
        main()
    except BrokenPipeError:  # pragma: no cover - CLI edge case
        pass
    except SystemExit:
        raise
    except Exception as exc:  # pragma: no cover - defensive fallback
        raise SystemExit(f'unexpected python error: {exc.__class__.__name__}: {exc}') from exc
