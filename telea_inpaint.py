import argparse
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
    parser.add_argument('--radius', type=float, default=3.0)
    args = parser.parse_args()

    fmt, input_path, mask_path, output_path = validate_args(args)

    image = cv2.imread(str(input_path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise SystemExit(f'failed to read input image: {input_path}')

    mask = read_mask(mask_path)

    image_bgr, original_alpha = ensure_bgr_and_alpha(image)
    mask_bin = normalize_mask(mask, image_bgr.shape)
    mask_nonzero = int(np.count_nonzero(mask_bin))
    print(
        f"[imgexe] telea_inpaint input={input_path.name} mask={mask_path.name} "
        f"size={image_bgr.shape[1]}x{image_bgr.shape[0]} mask_nonzero={mask_nonzero}",
        file=sys.stdout,
        flush=True,
    )

    if not mask_nonzero:
        raise SystemExit('mask is empty after thresholding; 请确认蒙版中白色区域就是要去除的水印')

    result = cv2.inpaint(image_bgr, mask_bin, args.radius, cv2.INPAINT_TELEA)
    if result is None or result.size == 0:
        raise SystemExit('opencv inpaint returned empty result')

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
