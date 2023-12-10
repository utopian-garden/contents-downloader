$filesToCopy = @("Order.bat", "Order.ps1", "Order.lst")

$directories = Get-ChildItem E:\Sankaku\_image -Directory
$directories += Get-ChildItem E:\Sankaku\_video -Directory
$directories += Get-ChildItem E:\Sankaku\_image\_ok -Directory
$directories += Get-ChildItem E:\Sankaku\_video\_ok -Directory

foreach ($dir in $directories) {
  foreach ($file in $filesToCopy) {
    Copy-Item $file $dir.FullName -Force
  }
}
