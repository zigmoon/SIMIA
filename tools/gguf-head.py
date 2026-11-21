# Lit l'en-tete GGUF de LTX-2.3 : dimension cachee, blocs, famille.
import struct
import sys

PATH = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\zigmo\AppData\Local\Temp\ltx23-head.gguf"

SIZES = {0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8}
FMT = {0: "<B", 1: "<b", 2: "<H", 3: "<h", 4: "<I", 5: "<i", 6: "<f", 7: "<?", 10: "<Q", 11: "<q", 12: "<d"}


def read_string(data, offset):
    (length,) = struct.unpack_from("<Q", data, offset)
    offset += 8
    return data[offset:offset + length].decode("utf-8", "replace"), offset + length


def read_value(data, offset, kind):
    if kind == 8:
        return read_string(data, offset)
    if kind == 9:
        (sub,) = struct.unpack_from("<I", data, offset)
        offset += 4
        (count,) = struct.unpack_from("<Q", data, offset)
        offset += 8
        items = []
        for _ in range(min(count, 5000)):
            value, offset = read_value(data, offset, sub)
            items.append(value)
        return items, offset
    fmt = FMT[kind]
    (value,) = struct.unpack_from(fmt, data, offset)
    return value, offset + SIZES[kind]


with open(PATH, "rb") as handle:
    data = handle.read()

magic = data[:4].decode("ascii")
(version,) = struct.unpack_from("<I", data, 4)
(n_tensors,) = struct.unpack_from("<Q", data, 8)
(n_kv,) = struct.unpack_from("<Q", data, 16)
print(f"{magic} v{version} | {n_tensors} tenseurs | {n_kv} champs")

offset = 24
fields = {}
for _ in range(n_kv):
    name, offset = read_string(data, offset)
    (kind,) = struct.unpack_from("<I", data, offset)
    offset += 4
    value, offset = read_value(data, offset, kind)
    fields[name] = value

print("--- champs utiles ---")
for name, value in fields.items():
    low = name.lower()
    if any(key in low for key in ("embd", "block_count", "n_layer", "hidden", "audio", "name", "arch", "patch", "refiner", "dim")):
        text = str(value)
        if len(text) > 90:
            text = text[:90] + "..."
        print(f"  {name} = {text}")
