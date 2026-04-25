$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $projectRoot 'package.json'
$packageJson = Get-Content $packageJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json

$productName = [string]$packageJson.build.productName
if ([string]::IsNullOrWhiteSpace($productName)) {
  $productName = [string]$packageJson.name
}

$version = [string]$packageJson.version
$author = [string]$packageJson.author

$buildDir = Join-Path $projectRoot 'build'
$assetsDir = Join-Path $projectRoot 'assets'
$iconPath = Join-Path $buildDir 'icon.ico'
$defaultAppIconPath = Join-Path $buildDir 'uninstallerIcon.ico'
$sidebarPath = Join-Path $buildDir 'installerSidebar.bmp'

$canonicalSourceImagePaths = @(
  (Join-Path $assetsDir 'app-icon.png'),
  (Join-Path $assetsDir 'app-icon.jpg'),
  (Join-Path $assetsDir 'app-icon.jpeg'),
  (Join-Path $assetsDir 'app-icon.bmp'),
  (Join-Path $assetsDir 'app-icon.webp')
)

$sourceImagePath = $canonicalSourceImagePaths |
  Where-Object { Test-Path $_ } |
  Select-Object -First 1

if ([string]::IsNullOrWhiteSpace($sourceImagePath) -or -not (Test-Path $sourceImagePath)) {
  throw "未找到正式应用图标源文件，请提供 assets\\app-icon.png（或 jpg/jpeg/bmp/webp）"
}

if (-not (Test-Path $buildDir)) {
  New-Item -ItemType Directory -Path $buildDir -Force | Out-Null
}

function New-ResizedBitmap {
  param(
    [System.Drawing.Image]$Image,
    [int]$Width,
    [int]$Height
  )

  $bitmap = New-Object System.Drawing.Bitmap $Width, $Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.DrawImage($Image, 0, 0, $Width, $Height)
  }
  finally {
    $graphics.Dispose()
  }

  return $bitmap
}

function Write-IcoFromImage {
  param(
    [string]$SourcePath,
    [string]$OutputPath
  )

  $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if (-not $pythonCommand) {
    throw "生成安装图标需要 Python（含 Pillow）"
  }

  $tempScriptPath = Join-Path ([System.IO.Path]::GetTempPath()) ("write-ico-{0}.py" -f [guid]::NewGuid().ToString('N'))
  $pythonCode = @"
from PIL import Image

source_path = r'''$SourcePath'''
output_path = r'''$OutputPath'''
sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

image = Image.open(source_path).convert('RGBA')
image.save(output_path, format='ICO', sizes=sizes)
"@

  try {
    [System.IO.File]::WriteAllText($tempScriptPath, $pythonCode, [System.Text.UTF8Encoding]::new($false))
    & $pythonCommand.Source $tempScriptPath
    if ($LASTEXITCODE -ne 0) {
      throw "Python 图标生成失败: $OutputPath"
    }
  }
  finally {
    if (Test-Path $tempScriptPath) {
      Remove-Item -LiteralPath $tempScriptPath -Force -ErrorAction SilentlyContinue
    }
  }
}

function Write-InstallerSidebar {
  param(
    [System.Drawing.Image]$Image,
    [string]$OutputPath,
    [string]$Title,
    [string]$Version,
    [string]$Author
  )

  $width = 164
  $height = 314
  $bitmap = New-Object System.Drawing.Bitmap $width, $height, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)

  try {
    $graphics.Clear([System.Drawing.Color]::FromArgb(246, 247, 249))
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    $iconBitmap = New-ResizedBitmap -Image $Image -Width 104 -Height 104
    try {
      $graphics.DrawImage($iconBitmap, 30, 28, 104, 104)
    }
    finally {
      $iconBitmap.Dispose()
    }

    $titleFont = New-Object System.Drawing.Font 'Microsoft YaHei UI', 16, ([System.Drawing.FontStyle]::Bold)
    $metaFont = New-Object System.Drawing.Font 'Microsoft YaHei UI', 11, ([System.Drawing.FontStyle]::Regular)
    $titleBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(36, 36, 36))
    $metaBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(96, 96, 96))
    $accentPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(220, 45, 35), 2)
    $stringFormat = New-Object System.Drawing.StringFormat
    $stringFormat.Alignment = [System.Drawing.StringAlignment]::Center
    $stringFormat.LineAlignment = [System.Drawing.StringAlignment]::Near

    $versionLabel = "{0}{1} v{2}" -f ([char]0x7248), ([char]0x672C), $Version
    $authorLabel = "{0}{1}: {2}" -f ([char]0x4F5C), ([char]0x8005), $Author

    try {
      $graphics.DrawString($Title, $titleFont, $titleBrush, (New-Object System.Drawing.RectangleF 12, 146, 140, 48), $stringFormat)
      $graphics.DrawLine($accentPen, 26, 206, 138, 206)
      $graphics.DrawString($versionLabel, $metaFont, $metaBrush, (New-Object System.Drawing.RectangleF 12, 216, 140, 22), $stringFormat)
      if (-not [string]::IsNullOrWhiteSpace($Author)) {
        $graphics.DrawString($authorLabel, $metaFont, $metaBrush, (New-Object System.Drawing.RectangleF 12, 250, 140, 22), $stringFormat)
      }
    }
    finally {
      $titleFont.Dispose()
      $metaFont.Dispose()
      $titleBrush.Dispose()
      $metaBrush.Dispose()
      $accentPen.Dispose()
      $stringFormat.Dispose()
    }

    $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
  }
  finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

$sourceImage = [System.Drawing.Image]::FromFile($sourceImagePath)
try {
  Write-IcoFromImage -SourcePath $sourceImagePath -OutputPath $iconPath
  Write-IcoFromImage -SourcePath $sourceImagePath -OutputPath $defaultAppIconPath
  $sourceImage.Save((Join-Path $buildDir 'verify-default-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
  Write-InstallerSidebar -Image $sourceImage -OutputPath $sidebarPath -Title $productName -Version $version -Author $author
}
finally {
  $sourceImage.Dispose()
}
