# サブディレクトリ内の指定ファイルを一括削除
Get-ChildItem -Directory | Get-ChildItem -Recurse -Include *.lst, *.bat, *.ps1 -Exclude cleaner.* | Remove-Item -Force
