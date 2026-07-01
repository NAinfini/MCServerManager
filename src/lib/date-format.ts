export function formatDate(value: string | null | undefined) {
  return formatDateValue(value, { dateStyle: "medium" });
}

export function formatDateTime(value: string | null | undefined) {
  return formatDateValue(value, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDateValue(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
) {
  if (!value) {
    return "Not available";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat(undefined, options).format(date);
}
