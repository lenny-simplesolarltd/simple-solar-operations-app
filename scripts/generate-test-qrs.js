const fs = require('fs/promises');
const path = require('path');
const QRCode = require('qrcode');

async function main() {
  const baseUrl = process.argv[2] || 'http://localhost:3000';
  const outputDir =
    process.argv[3] || path.join(process.cwd(), 'public', 'test-qr');
  const normalizedBase = baseUrl.replace(/\/+$/, '');

  const samples = [
    { name: 'plain-A6F3HW7L', value: 'A6F3HW7L' },
    {
      name: 'code-B7G4JX9M',
      value: `${normalizedBase}/code/B7G4JX9M`
    },
    {
      name: 'query-C8H5KY0N',
      value: `${normalizedBase}?code=C8H5KY0N`
    }
  ];

  await fs.mkdir(outputDir, { recursive: true });

  await Promise.all(
    samples.map(async (sample) => {
      const filePath = path.join(outputDir, `${sample.name}.png`);
      await QRCode.toFile(filePath, sample.value, { width: 512, margin: 2 });
      return filePath;
    })
  );

  console.log(`Generated ${samples.length} QR codes in ${outputDir}`);
  samples.forEach((sample) => {
    console.log(`${sample.name}: ${sample.value}`);
  });
}

main().catch((error) => {
  console.error('Failed to generate QR codes:', error);
  process.exit(1);
});
