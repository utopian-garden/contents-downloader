jq -r '.[]
  | if .array then . else . + { "array": [{"f1":""}] } end
  | {a: .name, b: .value, c: .array[]}
  | [.a, .b, .c.f1]' test.json
