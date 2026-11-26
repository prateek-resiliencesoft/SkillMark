/**
 * Programming languages offered in the interview code editor, with Monaco mode,
 * editor settings and per-language starter-code generation.
 *
 * `version` / `runnerId` match the OnlineCompiler.io runtimes (GET https://api.onlinecompiler.io/api/compilers/).
 * A language without `runnerId` can be edited but not executed.
 */
export interface CodeLanguage {
  id: string; // stored value + Monaco language id
  label: string;
  version: string;
  badge: string; // short text icon
  color: string; // badge colour
  tabSize: number;
  insertSpaces: boolean;
  ext: string;
  /** Execution runtime id at the code runner (OnlineCompiler.io compiler id). */
  runnerId?: string;
}

export const CODE_LANGUAGES: CodeLanguage[] = [
  { id: "javascript", label: "JavaScript", version: "Node.js 24", badge: "JS", color: "#F7DF1E", tabSize: 2, insertSpaces: true, ext: "js", runnerId: "nodejs-24" },
  { id: "typescript", label: "TypeScript", version: "Deno", badge: "TS", color: "#3178C6", tabSize: 2, insertSpaces: true, ext: "ts", runnerId: "typescript-deno" },
  { id: "python", label: "Python", version: "3.14", badge: "PY", color: "#3776AB", tabSize: 4, insertSpaces: true, ext: "py", runnerId: "python-3.14" },
  { id: "java", label: "Java", version: "OpenJDK 25", badge: "JV", color: "#E76F00", tabSize: 4, insertSpaces: true, ext: "java", runnerId: "openjdk-25" },
  { id: "cpp", label: "C++", version: "G++ 15, C++20", badge: "C++", color: "#00599C", tabSize: 4, insertSpaces: true, ext: "cpp", runnerId: "g++-15-cpp20" },
  { id: "c", label: "C", version: "GCC 15", badge: "C", color: "#A8B9CC", tabSize: 4, insertSpaces: true, ext: "c", runnerId: "gcc-15" },
  { id: "csharp", label: "C#", version: ".NET 10", badge: "C#", color: "#68217A", tabSize: 4, insertSpaces: true, ext: "cs", runnerId: "dotnet-csharp-10" },
  { id: "go", label: "Go", version: "1.26", badge: "GO", color: "#00ADD8", tabSize: 4, insertSpaces: false, ext: "go", runnerId: "go-1.26" },
  { id: "rust", label: "Rust", version: "1.93", badge: "RS", color: "#DEA584", tabSize: 4, insertSpaces: true, ext: "rs", runnerId: "rust-1.93" },
  { id: "kotlin", label: "Kotlin", version: "2.4", badge: "KT", color: "#7F52FF", tabSize: 4, insertSpaces: true, ext: "kt", runnerId: "kotlin-2.4" },
  { id: "php", label: "PHP", version: "8.5", badge: "PHP", color: "#777BB4", tabSize: 4, insertSpaces: true, ext: "php", runnerId: "php-8.5" },
  { id: "ruby", label: "Ruby", version: "4.0", badge: "RB", color: "#CC342D", tabSize: 2, insertSpaces: true, ext: "rb", runnerId: "ruby-4.0" },
  { id: "sql", label: "SQL", version: "SQLite 3", badge: "SQL", color: "#336791", tabSize: 2, insertSpaces: true, ext: "sql", runnerId: "sqlite-3" },
  { id: "dart", label: "Dart", version: "3.13", badge: "DT", color: "#0175C2", tabSize: 2, insertSpaces: true, ext: "dart", runnerId: "dart-3.13" },
  { id: "swift", label: "Swift", version: "6.4", badge: "SW", color: "#F05138", tabSize: 4, insertSpaces: true, ext: "swift", runnerId: "swift-6.4" },
  { id: "scala", label: "Scala", version: "3.10", badge: "SC", color: "#DC322F", tabSize: 2, insertSpaces: true, ext: "scala", runnerId: "scala-3.10" },
  { id: "r", label: "R", version: "4.6", badge: "R", color: "#276DC3", tabSize: 2, insertSpaces: true, ext: "r", runnerId: "r-4.6" },
  { id: "perl", label: "Perl", version: "5.44", badge: "PL", color: "#39457E", tabSize: 4, insertSpaces: true, ext: "pl", runnerId: "perl-5.44" },
  { id: "lua", label: "Lua", version: "5.5", badge: "LUA", color: "#000080", tabSize: 2, insertSpaces: true, ext: "lua", runnerId: "lua-5.5" },
  { id: "haskell", label: "Haskell", version: "GHC 9.12", badge: "HS", color: "#5D4F85", tabSize: 2, insertSpaces: true, ext: "hs", runnerId: "haskell-9.12" },
  { id: "shell", label: "Bash", version: "5.2", badge: "SH", color: "#4EAA25", tabSize: 2, insertSpaces: true, ext: "sh", runnerId: "bash-5.2" },
  { id: "elixir", label: "Elixir", version: "1.20", badge: "EX", color: "#6E4A7E", tabSize: 2, insertSpaces: true, ext: "exs", runnerId: "elixir-1.20" },
  { id: "julia", label: "Julia", version: "1.13", badge: "JL", color: "#9558B2", tabSize: 4, insertSpaces: true, ext: "jl", runnerId: "julia-1.13" },
  { id: "objective-c", label: "Objective-C", version: "Clang 21", badge: "OC", color: "#438EFF", tabSize: 4, insertSpaces: true, ext: "m", runnerId: "clang-objc-21" },
  { id: "fortran", label: "Fortran", version: "GFortran 15", badge: "F90", color: "#734F96", tabSize: 2, insertSpaces: true, ext: "f90", runnerId: "gfortran-15" },
  { id: "pascal", label: "Pascal", version: "Free Pascal 3.2", badge: "PAS", color: "#E3F171", tabSize: 2, insertSpaces: true, ext: "pas", runnerId: "fpc-3.2" },
  { id: "erlang", label: "Erlang", version: "OTP 29", badge: "ERL", color: "#A90533", tabSize: 4, insertSpaces: true, ext: "erl", runnerId: "erlang-29" },
  { id: "clojure", label: "Clojure", version: "1.12", badge: "CLJ", color: "#5881D8", tabSize: 2, insertSpaces: true, ext: "clj", runnerId: "clojure-1.12" },
  { id: "fsharp", label: "F#", version: ".NET 10", badge: "F#", color: "#378BBA", tabSize: 4, insertSpaces: true, ext: "fs", runnerId: "dotnet-fsharp-10" },
  { id: "groovy", label: "Groovy", version: "6.0", badge: "GR", color: "#4298B8", tabSize: 4, insertSpaces: true, ext: "groovy", runnerId: "groovy-6.0" },
  { id: "zig", label: "Zig", version: "0.17", badge: "ZIG", color: "#F7A41D", tabSize: 4, insertSpaces: true, ext: "zig", runnerId: "zig-0.17" },
  { id: "nim", label: "Nim", version: "2.2", badge: "NIM", color: "#FFE953", tabSize: 2, insertSpaces: true, ext: "nim", runnerId: "nim-2.2" },
  { id: "crystal", label: "Crystal", version: "1.22", badge: "CR", color: "#000100", tabSize: 2, insertSpaces: true, ext: "cr", runnerId: "crystal-1.22" },
  { id: "ocaml", label: "OCaml", version: "5.4", badge: "ML", color: "#EC6813", tabSize: 2, insertSpaces: true, ext: "ml", runnerId: "ocaml-5.4" },
  { id: "d", label: "D", version: "LDC 1.43", badge: "D", color: "#B03931", tabSize: 4, insertSpaces: true, ext: "d", runnerId: "ldc-1.43" },
  { id: "vb", label: "Visual Basic", version: ".NET 10", badge: "VB", color: "#945DB7", tabSize: 4, insertSpaces: true, ext: "vb", runnerId: "dotnet-vbnet-10" },
  { id: "cobol", label: "COBOL", version: "GnuCOBOL 3.2", badge: "CBL", color: "#005CA5", tabSize: 4, insertSpaces: true, ext: "cob", runnerId: "gnucobol-3.2" },
  { id: "octave", label: "Octave", version: "11", badge: "OCT", color: "#0790C0", tabSize: 2, insertSpaces: true, ext: "m", runnerId: "octave-11" },
  { id: "lisp", label: "Common Lisp", version: "SBCL 2.6", badge: "LSP", color: "#3FB68B", tabSize: 2, insertSpaces: true, ext: "lisp", runnerId: "sbcl-2.6" },
  { id: "prolog", label: "Prolog", version: "SWI 10", badge: "PRO", color: "#E61B23", tabSize: 4, insertSpaces: true, ext: "pl", runnerId: "swipl-10" },
  { id: "racket", label: "Racket", version: "9.3", badge: "RKT", color: "#9F1D20", tabSize: 2, insertSpaces: true, ext: "rkt", runnerId: "racket-9.3" },
  { id: "ada", label: "Ada", version: "GNAT 15", badge: "ADA", color: "#02F88C", tabSize: 3, insertSpaces: true, ext: "adb", runnerId: "gnat-15" },
  { id: "powershell", label: "PowerShell", version: "7.6", badge: "PS", color: "#012456", tabSize: 4, insertSpaces: true, ext: "ps1", runnerId: "powershell-7.6" },
  { id: "freebasic", label: "FreeBASIC", version: "1.10", badge: "FB", color: "#3C6EB4", tabSize: 4, insertSpaces: true, ext: "bas", runnerId: "fbc-1.10" },
];

const ALIASES: Record<string, string> = {
  js: "javascript", node: "javascript", nodejs: "javascript", ts: "typescript",
  py: "python", python3: "python", "c++": "cpp", cplusplus: "cpp", "c#": "csharp", cs: "csharp",
  golang: "go", rs: "rust", kt: "kotlin", rb: "ruby",
  bash: "shell", sh: "shell", objc: "objective-c", "objective c": "objective-c", "f#": "fsharp", fs: "fsharp",
  hs: "haskell", ex: "elixir", jl: "julia", "vb.net": "vb", vbnet: "vb", "visual basic": "vb", "common lisp": "lisp", sbcl: "lisp",
  pl: "perl", ps1: "powershell", pwsh: "powershell", fpc: "pascal", ml: "ocaml", cbl: "cobol", clj: "clojure",
};

/** Normalise any stored/AI-provided language name to a registry id (unknown values pass through). */
export function normalizeLanguage(lang: string | null | undefined): string {
  const l = (lang ?? "").trim().toLowerCase();
  if (!l) return "javascript";
  return ALIASES[l] ?? l;
}

export function getLanguage(id: string): CodeLanguage | undefined {
  return CODE_LANGUAGES.find((l) => l.id === normalizeLanguage(id));
}

interface Signature {
  name: string;
  params: string[];
}

/** Best-effort extraction of the entry function name + parameter names from a starter snippet. */
export function extractSignature(code: string): Signature | null {
  const patterns: RegExp[] = [
    /function\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/, // JS/TS function
    /(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/, // arrow
    /def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/, // Python / Ruby
    /func\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/, // Go
    /fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/, // Rust
    /fun\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/, // Kotlin
    /(?:public|private|protected|static|\s)+[\w<>[\],\s]+?\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/, // Java/C#/C++
    /^[\w:<>*&\s]+?\s+\**([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/m, // C/C++
  ];
  for (const re of patterns) {
    const m = code.match(re);
    if (m && m[1] && !["if", "for", "while", "switch", "main", "catch"].includes(m[1])) {
      const params = (m[2] ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => {
          const cleaned = p.replace(/=.*$/, "").replace(/:.*$/, "").replace(/[*&[\]]/g, " ").trim();
          const parts = cleaned.split(/\s+/);
          // Go/Rust style "name type" vs C-style "type name"
          return /^(func|fn)/.test(m[0]) ? parts[0]! : parts[parts.length - 1]!;
        })
        .filter((p) => p && p !== "self" && /^[A-Za-z_]\w*$/.test(p));
      return { name: m[1], params };
    }
  }
  return null;
}

const toSnake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const toPascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Generate a language-appropriate starter template. Reuses the original starter verbatim for its own language. */
export function generateBoilerplate(
  target: string,
  starter?: { language: string; code: string } | null,
): string {
  const lang = normalizeLanguage(target);
  if (starter?.code && normalizeLanguage(starter.language) === lang) return starter.code;

  const sig = (starter?.code && extractSignature(starter.code)) || { name: "solve", params: ["input"] };
  const n = sig.name;
  const ps = sig.params.length ? sig.params : ["input"];
  const note = starter?.code ? "Translated signature from the question's starter code; adjust types as needed." : "Write your solution here.";

  switch (lang) {
    case "javascript":
      return `/**\n * ${note}\n */\nfunction ${n}(${ps.join(", ")}) {\n  // TODO\n}\n\n// console.log(${n}(...));\n`;
    case "typescript":
      return `// ${note}\nfunction ${n}(${ps.map((p) => `${p}: unknown`).join(", ")}): unknown {\n  // TODO\n  return null;\n}\n\n// console.log(${n}(...));\n`;
    case "python": {
      const f = toSnake(n);
      return `# ${note}\nclass Solution:\n    def ${f}(self, ${ps.map(toSnake).join(", ")}):\n        # TODO\n        pass\n\n\nif __name__ == "__main__":\n    # print(Solution().${f}(...))\n    pass\n`;
    }
    case "java":
      return `// ${note}\nimport java.util.*;\n\nclass Solution {\n    public Object ${n}(${ps.map((p) => `Object ${p}`).join(", ")}) {\n        // TODO\n        return null;\n    }\n}\n\npublic class Main {\n    public static void main(String[] args) {\n        Solution s = new Solution();\n        // System.out.println(s.${n}(...));\n    }\n}\n`;
    case "cpp":
      return `// ${note}\n#include <bits/stdc++.h>\nusing namespace std;\n\nclass Solution {\npublic:\n    auto ${n}(${ps.map((p) => `auto ${p}`).join(", ")}) {\n        // TODO\n        return 0;\n    }\n};\n\nint main() {\n    Solution s;\n    // cout << s.${n}(...) << endl;\n    return 0;\n}\n`;
    case "c":
      return `// ${note}\n#include <stdio.h>\n#include <stdlib.h>\n\nint ${n}(${ps.map((p) => `int ${p}`).join(", ")}) {\n    // TODO\n    return 0;\n}\n\nint main(void) {\n    // printf("%d\\n", ${n}(...));\n    return 0;\n}\n`;
    case "csharp":
      return `// ${note}\nusing System;\nusing System.Collections.Generic;\n\npublic class Solution {\n    public object ${toPascal(n)}(${ps.map((p) => `object ${p}`).join(", ")}) {\n        // TODO\n        return null;\n    }\n}\n\npublic class Program {\n    public static void Main() {\n        var s = new Solution();\n        // Console.WriteLine(s.${toPascal(n)}(...));\n    }\n}\n`;
    case "go":
      return `// ${note}\npackage main\n\nimport "fmt"\n\nfunc ${n}(${ps.map((p) => `${p} interface{}`).join(", ")}) interface{} {\n\t// TODO\n\treturn nil\n}\n\nfunc main() {\n\t// fmt.Println(${n}(...))\n\t_ = fmt.Println\n}\n`;
    case "rust":
      return `// ${note}\nfn ${toSnake(n)}(${ps.map((p) => `${toSnake(p)}: i64`).join(", ")}) -> i64 {\n    // TODO\n    0\n}\n\nfn main() {\n    // println!("{}", ${toSnake(n)}(...));\n}\n`;
    case "kotlin":
      return `// ${note}\nclass Solution {\n    fun ${n}(${ps.map((p) => `${p}: Any?`).join(", ")}): Any? {\n        // TODO\n        return null\n    }\n}\n\nfun main() {\n    val s = Solution()\n    // println(s.${n}(...))\n}\n`;
    case "php":
      return `<?php\n// ${note}\nclass Solution {\n    function ${n}(${ps.map((p) => `$${p}`).join(", ")}) {\n        // TODO\n    }\n}\n\n$s = new Solution();\n// echo $s->${n}(...);\n`;
    case "ruby":
      return `# ${note}\ndef ${toSnake(n)}(${ps.map(toSnake).join(", ")})\n  # TODO\nend\n\n# puts ${toSnake(n)}(...)\n`;
    case "sql":
      return `-- Write your SQL query below\nSELECT\n  *\nFROM\n  table_name;\n`;
    default:
      return HELLO_TEMPLATES[lang] ? HELLO_TEMPLATES[lang]!.replace("{note}", note) : (starter?.code ?? "");
  }
}

/** Hello-world starters (read one line of stdin) for languages without a hand-written translator. `{note}` is replaced. */
export const HELLO_TEMPLATES: Record<string, string> = {
  dart: `// {note}\nimport 'dart:io';\n\nvoid main() {\n  final name = stdin.readLineSync() ?? 'World';\n  print('Hello, $name!');\n}\n`,
  swift: `// {note}\nlet name = readLine() ?? "World"\nprint("Hello, \\(name)!")\n`,
  scala: `// {note}\nobject Main {\n  def main(args: Array[String]): Unit = {\n    val name = Option(scala.io.StdIn.readLine()).getOrElse("World")\n    println(s"Hello, $name!")\n  }\n}\n`,
  r: `# {note}\nname <- readLines(file("stdin"), n = 1)\nif (length(name) == 0) name <- "World"\ncat("Hello, ", name, "!\\n", sep = "")\n`,
  perl: `# {note}\nuse strict;\nuse warnings;\n\nmy $name = <STDIN> // "World";\nchomp $name;\nprint "Hello, $name!\\n";\n`,
  lua: `-- {note}\nlocal name = io.read("l") or "World"\nprint("Hello, " .. name .. "!")\n`,
  haskell: `-- {note}\nmain :: IO ()\nmain = do\n  name <- getLine\n  putStrLn ("Hello, " ++ name ++ "!")\n`,
  shell: `#!/bin/bash\n# {note}\nread -r name\necho "Hello, \${name:-World}!"\n`,
  elixir: `# {note}\nname = (IO.gets("") || "World") |> String.trim()\nIO.puts("Hello, #{name}!")\n`,
  julia: `# {note}\nname = readline()\nprintln("Hello, $(isempty(name) ? "World" : name)!")\n`,
  "objective-c": `// {note}\n#import <Foundation/Foundation.h>\n#include <stdio.h>\n\nint main(void) {\n    @autoreleasepool {\n        char buf[256] = "World";\n        if (fgets(buf, sizeof buf, stdin)) buf[strcspn(buf, "\\n")] = 0;\n        printf("Hello, %s!\\n", buf);\n    }\n    return 0;\n}\n`,
  fortran: `! {note}\nprogram main\n  implicit none\n  character(len=100) :: name\n  read(*, '(A)') name\n  print '(A)', 'Hello, ' // trim(name) // '!'\nend program main\n`,
  pascal: `{ {note} }\nprogram Main;\nvar name: string;\nbegin\n  ReadLn(name);\n  WriteLn('Hello, ', name, '!');\nend.\n`,
  erlang: `% {note}\n-module(main).\n-export([main/1]).\n\nmain(_) ->\n    Name = string:trim(io:get_line("")),\n    io:format("Hello, ~s!~n", [Name]).\n`,
  clojure: `; {note}\n(let [name (or (read-line) "World")]\n  (println (str "Hello, " name "!")))\n`,
  fsharp: `// {note}\nlet name = match stdin.ReadLine() with null -> "World" | s -> s\nprintfn "Hello, %s!" name\n`,
  groovy: `// {note}\ndef name = System.in.newReader().readLine() ?: "World"\nprintln "Hello, \${name}!"\n`,
  zig: `// {note}\nconst std = @import("std");\n\npub fn main() !void {\n    std.debug.print("Hello, World!\\n", .{});\n}\n`,
  nim: `# {note}\nlet name = stdin.readLine()\necho "Hello, ", name, "!"\n`,
  crystal: `# {note}\nname = gets || "World"\nputs "Hello, #{name.strip}!"\n`,
  ocaml: `(* {note} *)\nlet () =\n  let name = try read_line () with End_of_file -> "World" in\n  Printf.printf "Hello, %s!\\n" name\n`,
  d: `// {note}\nimport std.stdio;\nimport std.string : strip;\n\nvoid main() {\n    auto name = readln().strip;\n    writeln("Hello, ", name, "!");\n}\n`,
  vb: `' {note}\nImports System\n\nModule Program\n    Sub Main()\n        Dim name As String = Console.ReadLine()\n        Console.WriteLine("Hello, " & name & "!")\n    End Sub\nEnd Module\n`,
  cobol: `       *> {note}\n       IDENTIFICATION DIVISION.\n       PROGRAM-ID. MAIN.\n       DATA DIVISION.\n       WORKING-STORAGE SECTION.\n       01 WS-NAME PIC X(50).\n       PROCEDURE DIVISION.\n           ACCEPT WS-NAME.\n           DISPLAY "Hello, " FUNCTION TRIM(WS-NAME) "!".\n           STOP RUN.\n`,
  octave: `% {note}\nname = fgetl(stdin);\nprintf("Hello, %s!\\n", name);\n`,
  lisp: `; {note}\n(let ((name (or (read-line *standard-input* nil) "World")))\n  (format t "Hello, ~a!~%" name))\n`,
  prolog: `% {note}\n:- initialization(main).\n\nmain :-\n    read_line_to_string(user_input, Name),\n    format("Hello, ~w!~n", [Name]),\n    halt.\n`,
  racket: `#lang racket\n; {note}\n(define name (read-line))\n(printf "Hello, ~a!\\n" name)\n`,
  ada: `--  {note}\nwith Ada.Text_IO; use Ada.Text_IO;\n\nprocedure Main is\n   Name : constant String := Get_Line;\nbegin\n   Put_Line ("Hello, " & Name & "!");\nend Main;\n`,
  powershell: `# {note}\n$name = [Console]::In.ReadLine()\nWrite-Output "Hello, $name!"\n`,
  freebasic: `' {note}\nDim nm As String\nLine Input nm\nPrint "Hello, " & nm & "!"\n`,
};
