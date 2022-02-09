Get-ChildItem E:\Sankaku\_image `
  | Where-Object { $_.PSIsContainer } `
  | ForEach-Object -Process {
    Copy-Item Order.bat $_.FullName
    Copy-Item Order.ps1 $_.FullName
    Copy-Item Order.lst $_.FullName
  }

Get-ChildItem E:\Sankaku\_video `
  | Where-Object { $_.PSIsContainer } `
  | ForEach-Object -Process {
    Copy-Item Order.bat $_.FullName
    Copy-Item Order.ps1 $_.FullName
    Copy-Item Order.lst $_.FullName
  }
