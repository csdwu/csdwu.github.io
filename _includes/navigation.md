{% for link in site.data.navigation.main %}
  <a class="normal" href="{{ link.url }}">{{ link.title }}</a>
{% endfor %}

