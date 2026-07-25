#!/usr/bin/env python3
"""Build step: compress cities5000.txt into cities5000.json.gz"""
import json, gzip, sys, os

input_file = 'cities5000.txt'
output_file = 'cities5000.json.gz'

if not os.path.exists(input_file):
    print(f"{input_file} not found, skipping compression")
    sys.exit(0)

cities = []
with open(input_file, 'r', encoding='utf-8') as f:
    for line in f:
        parts = line.split('\t')
        if len(parts) > 14:
            try:
                cities.append({
                    'id': f'geo_{parts[0]}',
                    'name': parts[1],
                    'type': parts[7],
                    'population': int(parts[14]),
                    'latitude': float(parts[4]),
                    'longitude': float(parts[5]),
                    'countryCode': parts[8],
                    'admin1': parts[10],
                })
            except ValueError:
                pass

print(f'Parsed {len(cities)} cities')

with gzip.open(output_file, 'wt', encoding='utf-8') as f:
    json.dump(cities, f)

original_size = os.path.getsize(input_file)
compressed_size = os.path.getsize(output_file)
print(f'Compressed: {original_size/1024/1024:.1f} MB -> {compressed_size/1024/1024:.1f} MB ({compressed_size/original_size*100:.0f}%)')
