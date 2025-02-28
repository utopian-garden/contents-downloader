# コピーするファイルのリスト
$filesToCopy = @("Order.bat", "Order.ps1", "Order.lst")

# すべての対象ディレクトリを取得（1回の処理でまとめる）
$directories = Get-ChildItem E:\Sankaku\_image, E:\Sankaku\_video, E:\Sankaku\_image\_ok, E:\Sankaku\_video\_ok -Directory

# 各ディレクトリへまとめてコピー
foreach ($dir in $directories) {
  Copy-Item -Path $filesToCopy -Destination $dir.FullName -Force
}
