import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type {
  ProjectDetails as ProjectDetailsData,
  ProjectVersion,
} from "./marketplaceApi";
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
          referrerPolicy="no-referrer"
          src={project.iconUrl}
          onError={() => setFailed(true)}
        />
      ) : providerBranding?.iconSrc ? (
        <img alt="" aria-hidden="true" src={providerBranding.iconSrc} />
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
}: ProjectDetailsProps) {
  const { t } = useAppSettings();
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

  return (
    <section
      className="marketplace-details"
      aria-label={t("marketplace.details.aria")}
    >
      <div className="marketplace-details-heading">
        <ProjectDetailIcon project={project} provider={provider} />
        <span>
          <strong>{project.title}</strong>
          <span>{project.description}</span>
        </span>
      </div>
      {project.websiteUrl ? (
        <a className="marketplace-site-link" href={project.websiteUrl}>
          <ExternalLink aria-hidden="true" size={14} />
          {t("marketplace.openProviderPage", {
            provider: provider || t("marketplace.provider"),
          })}
        </a>
      ) : null}
      {project.body || project.description ? (
        <MarketplaceMarkdown source={project.body || project.description} />
      ) : null}
      {versions.length === 0 ? (
        <p className="danger-text">{t("marketplace.details.noCompatible")}</p>
      ) : (
        <div className="marketplace-version-list">
          {versions.map((version) => (
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
              <span>{version.name}</span>
              <small>{version.versionNumber}</small>
              {version.dependencies.some(
                (dependency) => dependency.dependencyType === "required",
              ) ? (
                <small>{t("marketplace.details.requiresDependencies")}</small>
              ) : null}
              {version.warnings.length > 0 ? (
                <small className="danger-text">
                  {version.warnings.join("; ")}
                </small>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
