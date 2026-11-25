"""Approximate documented XML.toJson serialization for synthetic tests only."""
import json
import sys
import xml.etree.ElementTree as ET

def name(value):
    return value.rsplit('}', 1)[-1]

def convert(elem):
    result = {'@' + name(k): v for k, v in elem.attrib.items()}
    for child in elem:
        key, val = name(child.tag), convert(child)
        if key not in result:
            result[key] = val
        elif isinstance(result[key], list):
            result[key].append(val)
        else:
            result[key] = [result[key], val]
    text = (elem.text or '').strip()
    if not result:
        return text if text else None
    if text:
        result['#text'] = text
    return result

root = ET.fromstring(sys.stdin.read())
print(json.dumps({name(root.tag): convert(root)}))
