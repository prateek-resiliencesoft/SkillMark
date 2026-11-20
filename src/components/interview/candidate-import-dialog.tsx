"use client";

import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { CheckCircle2, FileText, Loader2, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
    MAX_IMPORT_FILE_BYTES,
    parseCandidateSpreadsheet,
    SpreadsheetImportError,
    type ParsedCandidate,
} from "@/lib/documents/spreadsheet-import";

interface CandidateImportDialogProps {
  interviewId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

const TEMPLATE_HEADERS = [
  "Name",
  "Email",
  "Phone",
  "Gender",
  "Birthday",
  "Education",
  "School",
  "Major",
  "Graduation Year",
  "Work Experience",
];

const INSTRUCTIONS = [
  "Import Instructions",
  '1. Fields marked with * are required. If they are not filled in, the entire line will not be imported.',
  '2. "Name" *: participant\'s full name.',
  '3. "Email": valid email address, optional.',
  '4. "Phone": phone number with country code, optional.',
  '5. "Gender": options: Male, Female, Other.',
  '6. "Birthday": fill in the format of YYYY-MM, such as "1996-06".',
  '7. "Education": single choice, options: College, Bachelor, Master, PhD, MBA, Other.',
  '8. "School": school name.',
  '9. "Major": field of study.',
  '10. "Graduation Year": graduation year of the highest degree, fill in the format of YYYY, such as "2019".',
  '11. "Work Experience": options: Less than one year, 1 - 3 years, 3 - 5 years, 5 - 10 years, More than 10 years.',
  "12. Upload up to 10,000 records at a time.",
];

function generateTemplate(): void {
  const instructionRows: (string | number)[][] = INSTRUCTIONS.map((line) => [line]);
  const data = [
    ...instructionRows,
    TEMPLATE_HEADERS,
    ["Jane Smith", "jane@example.com", "+1234567890", "Female", "1996-06", "Bachelor", "MIT", "Computer Science", 2023, "1 - 3 years"],
    ["Bob Wang", "bob@example.com", "+9876543210", "Male", "1998-01", "Master", "Stanford University", "Data Science", 2025, "Less than one year"],
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  const numCols = TEMPLATE_HEADERS.length;

  // Set column widths
  ws["!cols"] = TEMPLATE_HEADERS.map((h) => ({
    wch: Math.max(h.length + 4, 18),
  }));

  // Merge each instruction row across all columns so text doesn't overflow
  ws["!merges"] = INSTRUCTIONS.map((_, i) => ({
    s: { r: i, c: 0 },
    e: { r: i, c: numCols - 1 },
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sessions");
  XLSX.writeFile(wb, "Candidate_Import_Template.xlsx");
}

type Step = "upload" | "preview" | "complete";

export function CandidateImportDialog({
  interviewId,
  open,
  onOpenChange,
  onImported,
}: CandidateImportDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [candidates, setCandidates] = useState<ParsedCandidate[]>([]);
  const [fileName, setFileName] = useState("");
  const [importedCount, setImportedCount] = useState(0);

  const bulkCreate = trpc.candidate.bulkCreate.useMutation({
    onSuccess: (data) => {
      setImportedCount(data.created);
      setStep("complete");
      onImported();
    },
    onError: (err) => {
      toast({
        title: "Import failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > MAX_IMPORT_FILE_BYTES) {
        toast({
          title: "File is too large",
          description: `Upload a file up to ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB.`,
          variant: "destructive",
        });
        return;
      }
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (ev) => {
        const data = ev.target?.result as ArrayBuffer;
        let parsed: ParsedCandidate[];
        try {
          parsed = parseCandidateSpreadsheet(data);
        } catch (err) {
          toast({
            title: "Could not read file",
            description: err instanceof SpreadsheetImportError ? err.message : "Save it as .xlsx or .csv and try again.",
            variant: "destructive",
          });
          return;
        }
        if (parsed.length === 0) {
          toast({
            title: "No valid sessions found",
            description: 'Make sure your file has a "Name" column header in the first row.',
            variant: "destructive",
          });
          return;
        }
        setCandidates(parsed);
        setStep("preview");
      };
      reader.readAsArrayBuffer(file);
    },
    [toast],
  );

  const handleImport = useCallback(() => {
    if (candidates.length === 0) return;
    bulkCreate.mutate({
      interviewId,
      candidates: candidates.map((c) => ({
        ...c,
        email: c.email || "",
      })),
    });
  }, [candidates, interviewId, bulkCreate]);

  const handleClose = useCallback(() => {
    setStep("upload");
    setCandidates([]);
    setFileName("");
    setImportedCount(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
    onOpenChange(false);
  }, [onOpenChange]);

  const stepIndex = step === "upload" ? 0 : step === "preview" ? 1 : 2;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Sessions</DialogTitle>
          <DialogDescription>
            Download the template, fill in session details, and upload to import.
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center justify-between px-4 py-3">
          {["Upload", "Import", "Complete"].map((label, i) => (
            <div key={label} className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                  i <= stepIndex
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {i < stepIndex ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={`text-sm ${
                  i <= stepIndex ? "font-medium" : "text-muted-foreground"
                }`}
              >
                {label}
              </span>
              {i < 2 && (
                <div
                  className={`mx-2 h-px w-12 ${
                    i < stepIndex ? "bg-primary" : "bg-muted"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="min-h-[200px] space-y-4">
          {step === "upload" && (
            <>
              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">
                  1. Download the{" "}
                  <button
                    type="button"
                    className="font-medium text-primary hover:underline"
                    onClick={generateTemplate}
                  >
                    Candidate_Import_Template.xlsx
                  </button>{" "}
                  to import sessions and make sure all cells are in text format.
                </p>
                <p className="text-sm text-muted-foreground">
                  2. Name is required for each session.
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={handleFileUpload}
              />

              {fileName ? (
                <div className="flex items-center gap-2 rounded-lg border p-3">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">{fileName}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFileName("");
                      setCandidates([]);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  className="w-full border-dashed py-8"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload
                </Button>
              )}

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (candidates.length > 0) setStep("preview");
                  }}
                  disabled={candidates.length === 0}
                >
                  Next
                </Button>
              </div>
            </>
          )}

          {step === "preview" && (
            <>
              <div className="rounded-lg border">
                <div className="max-h-[300px] overflow-auto code-scrollbar">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">#</th>
                        <th className="px-3 py-2 text-left font-medium">Name</th>
                        <th className="px-3 py-2 text-left font-medium">Email</th>
                        <th className="px-3 py-2 text-left font-medium">Phone</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map((c, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                          <td className="px-3 py-2">{c.name}</td>
                          <td className="px-3 py-2 text-muted-foreground">{c.email || "-"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{c.phone || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {candidates.length} session{candidates.length !== 1 ? "s" : ""} ready to import.
              </p>

              <div className="flex justify-between pt-2">
                <Button variant="outline" onClick={() => setStep("upload")}>
                  Back
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={bulkCreate.isLoading}
                >
                  {bulkCreate.isLoading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Import ({candidates.length})
                </Button>
              </div>
            </>
          )}

          {step === "complete" && (
            <div className="flex flex-col items-center py-8">
              <CheckCircle2 className="h-12 w-12 text-secondary-500" />
              <h3 className="mt-4 text-lg font-semibold">Import Complete</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Successfully imported {importedCount} session
                {importedCount !== 1 ? "s" : ""}.
              </p>
              <Button className="mt-6" onClick={handleClose}>
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
