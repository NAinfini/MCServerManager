export function formatDate(value: string | null | undefined, locale?: string) {
  return formatDateValue(value, { dateStyle: "medium" }, locale);
}

export function formatDateTime(
  value: string | null | undefined,
  locale?: string,
) {
  return formatDateValue(
    value,
    {
      dateStyle: "medium",
      timeStyle: "short",
    },
    locale,
  );
}

function formatDateValue(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
  locale?: string,
) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(locale, options).format(date);
}
