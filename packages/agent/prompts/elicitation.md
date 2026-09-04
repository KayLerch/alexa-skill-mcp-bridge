The user was asked: "{{message}}"

The answer must fit this JSON schema for the field "{{property}}":
{{schema}}

The user said: "{{answer}}"

Extract the value the user meant and return it in the field "value". Dates as YYYY-MM-DD, numbers as numbers, yes/no as booleans, choices as the exact allowed value. If the answer contains no usable value, return null.
