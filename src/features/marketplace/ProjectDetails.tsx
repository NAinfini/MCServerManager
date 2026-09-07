import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import type {
  ProjectDetails as ProjectDetailsData,
  ProjectVersion,
} from "./marketplaceApi";
import { isVerifiedServerPack } from "./marketplaceApi";
import { useAppSettings } from "../../i18n";
import { MarketplaceMarkdown } from "./MarketplaceMarkdown";
import { getMarketplaceProviderBranding } from "./providerBranding";

interface ProjectDetailsProps {
  project: ProjectDetailsData | null;
  versions: ProjectVersion[];
  isLoading: boolean;
  provider?: string;
  selectedVersionId: string | null;
  onSelectVersion: (versionId: string) => void;
  /* Rendered in the version panel footer so the primary action sits with the
     list it acts on instead of below a description that can run for pages. */
  versionAction?: ReactNode;
  versionsError?: ReactNode;
}

const BBSMC_EXTERNAL_DOWNLOAD_WARNING =
  "This BBSMC version also provides external disk download links.";

/* Providers overwhelmingly open their description with the pack name as an H1,
   which then lands directly under the heading that already says it. Dropping
   the duplicate is safe because the heading is always rendered. */
function stripDuplicateTitleHeading(body: string, title: string) {
  const normalized = title.trim().toLowerCase();
  return body.replace(
    /^\s*#{1,2}[ \t]+(.+?)[ \t]*(?:\r?\n|$)/,
    (match, heading) =>
      String(heading).trim().toLowerCase() === normalized ? "" : match,
  );
}

function ProjectDetailIcon({
  project,
  provider,
}: {
  project: ProjectDetailsData;
  provider?: string;
}) {
  const [failed, setFailed] = useState(false);
  const providerBranding = provider
    ? getMarketplaceProviderBranding(provider)
    : null;
  const fallback = project.title.slice(0, 1).toUpperCase();

  return (
    <span className="marketplace-detail-icon">
      {project.iconUrl && !failed ? (
        <img
          alt=""
          aria-hidden="true"
          height="64"
          referrerPolicy="no-referrer"
          src={project.iconUrl}
          width="64"
          onError={() => setFailed(true)}
        />
      ) : providerBranding?.iconSrc ? (
        <img
          alt=""
          aria-hidden="true"
          height="64"
          src={providerBranding.iconSrc}
          width="64"
        />
      ) : (
        <span>{fallback}</span>
      )}
    </span>
  );
}

export function ProjectDetails({
  project,
  versions,
  isLoading,
  provider,
  selectedVersionId,
  onSelectVersion,
  versionAction,
  versionsError,
}: ProjectDetailsProps) {
  const { formatCompactNumber, language, t } = useAppSettings();
  const warningLabel = (warning: string) =>
    provider === "BBSMC" && warning === BBSMC_EXTERNAL_DOWNLOAD_WARNING
      ? t("marketplace.bbsmc.externalDownload")
      : warning;

  if (isLoading) {
    return <div className="list-state">{t("marketplace.details.loading")}</div>;
  }

  if (!project) {
    return (
      <div className="empty-state">
        <h2>{t("marketplace.details.empty.title")}</h2>
        <p>{t("marketplace.details.empty.description")}</p>
      </div>
    );
  }

  const body = project.body
    ? stripDuplicateTitleHeading(project.body, project.title)
    : "";
  const updatedAt = project.updatedAt ? new Date(project.updatedAt) : null;
  const stats = [
    project.downloads === undefined || project.downloads === null
      ? null
      : {
          key: "downloads",
          label: t("marketplace.stat.downloads"),
          value: formatCompactNumber(project.downloads),
        },
    project.follows === undefined || project.follows === null
      ? null
      : {
          key: "follows",
          label: t("marketplace.stat.follows"),
          value: formatCompactNumber(project.follows),
        },
    project.modCount
      ? {
          key: "mods",
          label: t("marketplace.stat.mods"),
          value: formatCompactNumber(project.modCount),
        }
      : null,
    updatedAt && !Number.isNaN(updatedAt.getTime())
      ? {
          key: "updated",
          label: t("marketplace.stat.updated"),
          value: new Intl.DateTimeFormat(language, {
            dateStyle: "medium",
          }).format(updatedAt),
        }
      : null,
  ].filter((stat): stat is { key: string; label: string; value: string } =>
    Boolean(stat),
  );
  const tags = [...project.loaders, ...project.gameVersions].slice(0, 5);

  return (
    <section
      className="marketplace-details"
      aria-label={t("marketplace.details.aria")}
    >
      <header className="marketplace-details-hero">
        <ProjectDetailIcon project={project} provider={provider} />
        <div className="marketplace-details-headline">
          <h2>{project.title}</h2>
          <p>{project.description}</p>
          {stats.length > 0 ? (
            <dl
              aria-label={t("marketplace.projectStats")}
              className="marketplace-details-stats"
            >
              {stats.map((stat) => (
                <div key={stat.key}>
                  <dd>{stat.value}</dd>
                  <dt>{stat.label}</dt>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        <div className="marketplace-details-hero-aside">
          {project.websiteUrl ? (
            <a className="marketplace-site-link" href={project.websiteUrl}>
              <ExternalLink aria-hidden="true" size={14} />
              {t("marketplace.openProviderPage", {
                provider: provider || t("marketplace.provider"),
              })}
            </a>
          ) : null}
          {tags.length > 0 ? (
            <span className="marketplace-details-tags">
              {tags.map((tag) => (
                <span className="meta-badge" key={tag}>
                  {tag}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      </header>

      <div className="marketplace-details-split">
        <div className="marketplace-details-body">
          {body ? <MarketplaceMarkdown source={body} /> : null}
        </div>

        <aside className="marketplace-version-panel">
          {versionsError ? (
            versionsError
          ) : versions.length === 0 ? (
            <p className="danger-text">
              {t("marketplace.details.noCompatible")}
            </p>
          ) : (
            <>
              <div className="marketplace-version-heading">
                <h3>{t("marketplace.details.versions")}</h3>
                <span>
                  {t("marketplace.details.versionCount", {
                    count: versions.length,
                  })}
                </span>
              </div>
              <div className="marketplace-version-list">
                {versions.map((version, index) => {
                  const showVersionNumber =
                    version.versionNumber &&
                    version.versionNumber !== version.id &&
                    version.versionNumber !== version.name;
                  const chips = [
                    ...version.gameVersions.slice(0, 2),
                    ...version.loaders.slice(0, 1),
                  ];
                  return (
                    <button
                      className={
                        version.id === selectedVersionId
                          ? "marketplace-version-row marketplace-version-row-selected"
                          : "marketplace-version-row"
                      }
                      key={version.id}
                      type="button"
                      onClick={() => onSelectVersion(version.id)}
                    >
                      <span className="marketplace-version-summary">
                        <strong>{version.name}</strong>
                        {showVersionNumber ? (
                          <small>{version.versionNumber}</small>
                        ) : null}
                      </span>
                      <span className="marketplace-version-badges">
                        {index === 0 ? (
                          <span className="meta-badge meta-badge-latest">
                            {t("marketplace.details.latest")}
                          </span>
                        ) : null}
                        {chips.map((chip) => (
                          <span className="meta-badge" key={chip}>
                            {chip}
                          </span>
                        ))}
                        {isVerifiedServerPack(version) ? (
                          <span className="meta-badge meta-badge-verified">
                            {t("marketplace.serverPackBadge")}
                          </span>
                        ) : null}
                      </span>
                      <span className="marketplace-version-notes">
                        {version.dependencies.some(
                          (dependency) =>
                            dependency.dependencyType === "required",
                        ) ? (
                          <small>
                            {t("marketplace.details.requiresDependencies")}
                          </small>
                        ) : null}
                        {version.warnings.length > 0 ? (
                          <small className="danger-text">
                            {version.warnings.map(warningLabel).join("; ")}
                          </small>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
              {versionAction ? (
                <div className="marketplace-version-footer">
                  {versionAction}
                </div>
              ) : null}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
