{% assign page_data = site.data.embedded_ai %}
{% assign papers_data = site.data.embedded_ai_papers %}
{% assign default_visible_count = 20 %}

## {{ page_data.title }}

{% for paragraph in page_data.intro.paragraphs %}
{{ paragraph }}

{% endfor %}

## Useful Links

{% for link in page_data.useful_links %}
* [{{ link.title }}]({{ link.url }}){% if link.description %} — {{ link.description }}{% endif %}
{% endfor %}

## Papers

{% if papers_data and papers_data.categories and papers_data.categories.size > 0 %}

  {% for category in papers_data.categories %}
### {{ category.title }}{% if category.count %} ({{ category.count }}){% endif %}

    {% if category.papers and category.papers.size > 0 %}
<div class="embedded-ai-category" data-category-key="{{ category.key }}">
  <ul class="embedded-ai-paper-list" style="list-style: none; padding-left: 0; margin-left: 0;">
        {% for paper in category.papers %}
          {% assign paper_link = paper.urls.pdf | default: paper.urls.paper | default: paper.urls.scholar %}
          {% assign paper_tags = paper.final_tags | default: paper.tags %}
          {% assign is_hidden = false %}
          {% if forloop.index > default_visible_count %}
            {% assign is_hidden = true %}
          {% endif %}
    <li
      class="embedded-ai-paper-item"
      {% if is_hidden %}data-hidden-paper="true" style="display: none; margin-bottom: 1rem;"{% else %}style="margin-bottom: 1rem;"{% endif %}
    >
      <div class="embedded-ai-paper-entry">
              {% if paper_tags and paper_tags.size > 0 %}
        <div class="embedded-ai-paper-tags" style="margin-bottom: 0.25rem;">
                {% for tag in paper_tags %}
          <span
            class="embedded-ai-tag embedded-ai-tag-{{ tag | downcase }}"
            style="display: inline-block; margin-right: 0.35rem; margin-bottom: 0.2rem; padding: 0.1rem 0.45rem; border: 1px solid #ccc; border-radius: 999px; font-size: 0.82rem; font-weight: 600;"
          >
            {{ tag }}
          </span>
                {% endfor %}
        </div>
              {% endif %}

        <div class="embedded-ai-paper-title" style="font-weight: 600; margin-bottom: 0.2rem;">
                {% if paper_link != "" %}
          <a href="{{ paper_link }}" target="_blank" rel="noopener noreferrer">{{ paper.title }}</a>
                {% else %}
          {{ paper.title }}
                {% endif %}
        </div>

        <div class="embedded-ai-paper-meta" style="font-size: 0.95rem; color: #666; margin-bottom: 0.25rem;">
                {% if paper.venue %}
          <span>{{ paper.venue }}</span>
                {% endif %}
                {% if paper.year %}
                  {% if paper.venue %}<span> · </span>{% endif %}
          <span>{{ paper.year }}</span>
                {% endif %}
                {% if paper.matched_th_cpl_level %}
          <span> · TH-CPL {{ paper.matched_th_cpl_level }}</span>
                {% endif %}
                {% if paper.filter_bucket == "arxiv" %}
          <span> · arXiv</span>
                {% endif %}
        </div>

              {% if paper.authors and paper.authors.size > 0 %}
        <div class="embedded-ai-paper-authors" style="font-size: 0.92rem; margin-bottom: 0.25rem;">
          {{ paper.authors | join: ", " }}
        </div>
              {% endif %}

              {% if paper.abstract %}
        <div class="embedded-ai-paper-abstract" style="font-size: 0.92rem; color: #444;">
          {{ paper.abstract }}
        </div>
              {% endif %}
      </div>
    </li>
        {% endfor %}
  </ul>

      {% if category.papers.size > default_visible_count %}
  <button
    type="button"
    class="embedded-ai-show-more-btn"
    data-expanded="false"
    style="margin-top: 0.25rem; padding: 0.45rem 0.8rem; border: 1px solid #ccc; border-radius: 8px; background: transparent; cursor: pointer;"
  >
    Show more
  </button>
      {% endif %}
</div>
    {% else %}
No papers have been added to this category yet.
    {% endif %}

  {% endfor %}

{% else %}
No paper data is available yet.
{% endif %}

<script src="{{ '/assets/js/embedded-ai.js' | relative_url }}"></script>