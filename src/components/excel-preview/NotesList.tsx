import { StickyNote } from "lucide-react";

interface NotesListProps {
  notes: string[];
}

// Sección 5: notas sueltas ("NOTA; ...") detectadas en la hoja. Se muestran
// al final, en estilo texto muted con icono, separadas del resto de datos.
export function NotesList({ notes }: NotesListProps) {
  if (notes.length === 0) return null;

  return (
    <section className="shrink-0 glass rounded-xl p-3 space-y-2">
      <h2 className="panel-kicker px-1">Notas</h2>
      <ul className="space-y-1.5">
        {notes.map((note, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-xs text-muted-foreground leading-relaxed"
          >
            <StickyNote className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground/70" />
            <span>{note}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
