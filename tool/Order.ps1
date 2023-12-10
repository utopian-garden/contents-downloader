Import-Csv Order.lst | ForEach-Object {
  $ext = $_.extension
  $dir = $_.directory

  $INCLUDES = @("*.$ext")
  Get-ChildItem -Include $INCLUDES -File *.* `
  | ForEach-Object -Process {
    if (!(Test-Path $dir)) {
      New-Item $dir -ItemType Directory
    }

    Move-Item -literalpath $_ $dir -force
  }

  if (Test-Path $dir) {
    if (!(Test-Path $dir\ok)) {
      New-Item $dir\ok -ItemType Directory
    }

    if (!(Test-Path $dir\_safe)) {
      New-Item $dir\_safe -ItemType Directory
    }
  }
}
