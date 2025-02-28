# 各サブディレクトリ内で、最新10個を残し、古いものを削除
Get-ChildItem -Directory | ForEach-Object {
  Get-ChildItem $_.FullName -Exclude *.lst, *.bat, *.ps1 |
  Sort-Object LastWriteTime |
  Select-Object -Skip 10 |
  Remove-Item -Force
}
