import sharp from 'sharp'
import { readFile, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { resolve } from 'node:path'

async function main() {
  const pngPath = resolve('public', 'icon.png')
  const svgPath = resolve('public', 'icon.svg')
  let sourceBuf
  let sourceType
  try {
    await access(pngPath, constants.F_OK)
    sourceBuf = await readFile(pngPath)
    sourceType = 'png'
  } catch (_) {
    try {
      await access(svgPath, constants.F_OK)
      sourceBuf = await readFile(svgPath)
      sourceType = 'svg'
    } catch {
      console.error('No icon found. Place public/icon.png or public/icon.svg')
      process.exit(1)
    }
  }

  const outputs = [
    { file: resolve('public', 'favicon-32.png'), size: 32 },
    { file: resolve('public', 'icon-192.png'), size: 192 },
    { file: resolve('public', 'icon-512.png'), size: 512 },
  ]

  for (const { file, size } of outputs) {
    await sharp(sourceBuf)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(file)
    console.log(`Generated ${file} from ${sourceType}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
