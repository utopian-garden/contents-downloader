Import-Csv Order.lst | ForEach-Object {
  $ext = $_.extension
  $dir = $_.directory

  # 指定拡張子のファイルを取得
  $files = Get-ChildItem -Filter "*.$ext" -File

  # ファイルが存在する場合のみ処理を実行
  if ($files) {
    # 必要なディレクトリを一括作成（存在しない場合のみ）
    New-Item -Path $dir, "$dir\ok", "$dir\_safe" -ItemType Directory -Force | Out-Null

    # 取得したファイルを移動
    $files | Move-Item -Destination $dir -Force
  }
}
