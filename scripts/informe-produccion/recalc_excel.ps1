param([Parameter(Mandatory=$true)][string]$Ruta, [string]$Pdf = "")
$ErrorActionPreference = "Stop"
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
try {
  $wb = $excel.Workbooks.Open((Resolve-Path $Ruta).Path)
  $excel.CalculateFullRebuild()
  while ($excel.CalculationState -ne 0) { Start-Sleep -Milliseconds 200 }
  $totalFormulas = 0
  $totalErrores = 0
  $detalles = @()
  foreach ($ws in $wb.Worksheets) {
    $formulas = $null
    try { $formulas = $ws.UsedRange.SpecialCells(-4123) } catch {}
    if ($formulas -ne $null) { $totalFormulas += $formulas.Count }
    $errs = $null
    try { $errs = $ws.UsedRange.SpecialCells(-4123, 16) } catch {}
    if ($errs -ne $null) {
      foreach ($c in $errs) {
        $totalErrores += 1
        if ($detalles.Count -lt 25) { $detalles += ("{0}!{1} = {2}" -f $ws.Name, $c.Address($false,$false), $c.Text) }
      }
    }
  }
  $wb.Save()
  if ($Pdf -ne "") {
    $rutaPdf = [System.IO.Path]::GetFullPath($Pdf)
    $wb.ExportAsFixedFormat(0, $rutaPdf)
    Write-Output ("pdf=" + $rutaPdf)
  }
  $wb.Close($false)
  Write-Output ("formulas={0} errores={1}" -f $totalFormulas, $totalErrores)
  $detalles | ForEach-Object { Write-Output ("  ERROR " + $_) }
  if ($totalErrores -gt 0) { exit 2 }
} finally {
  $excel.Quit()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($excel) | Out-Null
}
